package cn.sifangguan.hotelaios.integrations.wecom;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Persists store-specific group robot destinations without disclosing them.
 *
 * The feature is intentionally separate from the OAuth/callback WeCom path. A
 * stored destination alone cannot produce a message: the delivery feature flag
 * remains independently disabled until a separately authorised rollout.
 */
@Service
public class WeComGroupRobotWebhookService {
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final String WECOM_WEBHOOK_HOST = "qyapi.weixin.qq.com";
    private static final String WECOM_WEBHOOK_PATH = "/cgi-bin/webhook/send";

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final byte[] encryptionKey;

    public WeComGroupRobotWebhookService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            @Value("${app.wecom.group-robot.encryption-key:}") String encryptionKey
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.encryptionKey = parseEncryptionKey(encryptionKey);
    }

    @Transactional(readOnly = true)
    public List<WeComGroupRobotWebhookModels.StoreWebhookStatus> listStoreWebhooks() {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        if (!principal.hasTenantScope() && principal.orgScopes().isEmpty()) {
            return List.of();
        }

        MapSqlParameterSource parameters = base(principal);
        String visibility = visibleHotels("hotel", principal, parameters);
        return jdbc.query("""
                select hotel.id as hotel_org_unit_id, hotel.code as hotel_code, hotel.name as hotel_name,
                       (configuration.id is not null) as configured,
                       configuration.updated_at,
                       updater.display_name as updated_by_name
                from org_unit hotel
                left join wecom_group_robot_webhook configuration
                  on configuration.tenant_id = hotel.tenant_id
                 and configuration.hotel_org_unit_id = hotel.id
                left join user_account updater
                  on updater.tenant_id = configuration.tenant_id
                 and updater.id = configuration.updated_by
                where hotel.tenant_id = :tenantId
                  and hotel.unit_type = 'HOTEL'
                  and hotel.status = 'ACTIVE'
                """ + visibility + " order by hotel.sort_order, hotel.name", parameters,
                (resultSet, rowNumber) -> new WeComGroupRobotWebhookModels.StoreWebhookStatus(
                        resultSet.getObject("hotel_org_unit_id", UUID.class),
                        resultSet.getString("hotel_code"),
                        resultSet.getString("hotel_name"),
                        resultSet.getBoolean("configured"),
                        resultSet.getObject("updated_at", OffsetDateTime.class),
                        resultSet.getString("updated_by_name"),
                        encryptionKey != null
                ));
    }

    @Transactional
    public WeComGroupRobotWebhookModels.SaveWebhookResult saveStoreWebhook(
            UUID hotelOrgUnitId,
            WeComGroupRobotWebhookModels.SaveWebhook request
    ) {
        accessPolicy.requirePermission("org.manage");
        TenantPrincipal principal = prepare();
        requireActiveHotel(principal, hotelOrgUnitId);
        accessPolicy.requireOrgScope(hotelOrgUnitId);

        URI webhook = validateWebhook(request.webhookUrl());
        EncryptionResult encrypted = encrypt(webhook.toString(), principal.tenantId(), hotelOrgUnitId);
        String endpointHash = sha256(webhook.toString());
        MapSqlParameterSource parameters = base(principal)
                .addValue("id", UUID.randomUUID())
                .addValue("hotelOrgUnitId", hotelOrgUnitId)
                .addValue("ciphertext", encrypted.ciphertext())
                .addValue("nonce", encrypted.nonce())
                .addValue("webhookHash", endpointHash)
                .addValue("actorId", principal.actorId());

        jdbc.update("""
                insert into wecom_group_robot_webhook
                    (id, tenant_id, hotel_org_unit_id, webhook_ciphertext, encryption_nonce,
                     webhook_hash, created_by, updated_by)
                values
                    (:id, :tenantId, :hotelOrgUnitId, :ciphertext, :nonce,
                     :webhookHash, :actorId, :actorId)
                on conflict (tenant_id, hotel_org_unit_id) do update
                set webhook_ciphertext = excluded.webhook_ciphertext,
                    encryption_nonce = excluded.encryption_nonce,
                    webhook_hash = excluded.webhook_hash,
                    updated_by = excluded.updated_by,
                    updated_at = now(),
                    row_version = wecom_group_robot_webhook.row_version + 1
                """, parameters);

        OffsetDateTime updatedAt = jdbc.queryForObject("""
                select updated_at from wecom_group_robot_webhook
                where tenant_id = :tenantId and hotel_org_unit_id = :hotelOrgUnitId
                """, parameters, OffsetDateTime.class);
        auditWriter.record("WECOM_GROUP_ROBOT_WEBHOOK_CONFIGURED", "WECOM_GROUP_ROBOT_WEBHOOK", hotelOrgUnitId,
                "{\"configured\":true}");
        return new WeComGroupRobotWebhookModels.SaveWebhookResult(hotelOrgUnitId, true, updatedAt);
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String visibleHotels(String hotelAlias, TenantPrincipal principal, MapSqlParameterSource parameters) {
        if (principal.hasTenantScope()) {
            return "";
        }
        parameters.addValue("scopeIds", principal.orgScopes());
        return " and exists (select 1 from org_unit_closure visible where visible.tenant_id = " + hotelAlias
                + ".tenant_id and visible.descendant_id = " + hotelAlias
                + ".id and visible.ancestor_id in (:scopeIds))";
    }

    private void requireActiveHotel(TenantPrincipal principal, UUID hotelOrgUnitId) {
        List<Map<String, Object>> hotels = jdbc.queryForList("""
                select unit_type, status from org_unit
                where tenant_id = :tenantId and id = :hotelOrgUnitId
                """, base(principal).addValue("hotelOrgUnitId", hotelOrgUnitId));
        if (hotels.isEmpty() || !"HOTEL".equals(String.valueOf(hotels.getFirst().get("unit_type")))) {
            throw new IllegalArgumentException("Webhook can only be configured for an existing hotel");
        }
        if (!"ACTIVE".equals(String.valueOf(hotels.getFirst().get("status")))) {
            throw new IllegalArgumentException("Webhook cannot be configured for an inactive hotel");
        }
    }

    private static URI validateWebhook(String rawWebhook) {
        try {
            URI webhook = URI.create(rawWebhook.trim());
            if (!"https".equalsIgnoreCase(webhook.getScheme())
                    || !WECOM_WEBHOOK_HOST.equalsIgnoreCase(webhook.getHost())
                    || (webhook.getPort() != -1 && webhook.getPort() != 443)
                    || webhook.getRawUserInfo() != null
                    || webhook.getRawFragment() != null
                    || !WECOM_WEBHOOK_PATH.equals(webhook.getRawPath())) {
                throw new IllegalArgumentException("Webhook must be an official HTTPS WeCom group robot endpoint");
            }
            String query = webhook.getRawQuery();
            if (query == null || query.isBlank() || query.contains("&") || !query.startsWith("key=")
                    || query.length() <= "key=".length()) {
                throw new IllegalArgumentException("Webhook must include exactly one group robot key");
            }
            return webhook;
        } catch (IllegalArgumentException exception) {
            if (exception.getMessage() != null && exception.getMessage().startsWith("Webhook")) {
                throw exception;
            }
            throw new IllegalArgumentException("Webhook URL is invalid");
        }
    }

    private EncryptionResult encrypt(String plaintext, UUID tenantId, UUID hotelOrgUnitId) {
        if (encryptionKey == null) {
            throw new IllegalStateException("WECOM_GROUP_ROBOT_ENCRYPTION_KEY must be configured before saving Webhooks");
        }
        try {
            byte[] nonce = new byte[12];
            SECURE_RANDOM.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(encryptionKey, "AES"), new GCMParameterSpec(128, nonce));
            cipher.updateAAD((tenantId + ":" + hotelOrgUnitId).getBytes(StandardCharsets.UTF_8));
            return new EncryptionResult(nonce, cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to secure the WeCom group robot Webhook", exception);
        }
    }

    private static byte[] parseEncryptionKey(String rawKey) {
        if (rawKey == null || rawKey.isBlank()) {
            return null;
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(rawKey.trim());
            if (decoded.length != 32) {
                throw new IllegalArgumentException("WECOM_GROUP_ROBOT_ENCRYPTION_KEY must decode to exactly 32 bytes");
            }
            return decoded;
        } catch (IllegalArgumentException exception) {
            if (exception.getMessage() != null && exception.getMessage().startsWith("WECOM_GROUP_ROBOT")) {
                throw exception;
            }
            throw new IllegalArgumentException("WECOM_GROUP_ROBOT_ENCRYPTION_KEY must be Base64 encoded", exception);
        }
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private record EncryptionResult(byte[] nonce, byte[] ciphertext) {
    }
}
