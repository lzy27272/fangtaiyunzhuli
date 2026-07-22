package cn.sifangguan.hotelaios.shared.idempotency;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/** Atomic command-key reservation used inside the caller's business transaction. */
@Service
public class CommandIdempotencyService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final ObjectMapper objectMapper;

    public CommandIdempotencyService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.objectMapper = objectMapper;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public Reservation reserve(String commandScope, String idempotencyKey, Object request, UUID traceId) {
        TenantPrincipal principal = prepare();
        String scope = required(commandScope, "commandScope").toUpperCase(Locale.ROOT);
        String key = required(idempotencyKey, "Idempotency-Key");
        if (key.length() > 200) {
            throw new IllegalArgumentException("Idempotency-Key长度不能超过200字符");
        }
        String requestHash = hash(canonical(request));
        UUID reservationId = UUID.randomUUID();
        int inserted = jdbc.update("""
                insert into command_idempotency_record
                    (id, tenant_id, command_scope, idempotency_key, request_hash, status,
                     trace_id, correlation_id, expires_at)
                values
                    (:id, :tenantId, :scope, :key, :requestHash, 'IN_PROGRESS',
                     :traceId, :correlationId, now() + interval '24 hours')
                on conflict (tenant_id, command_scope, idempotency_key) do nothing
                """, base(principal)
                .addValue("id", reservationId)
                .addValue("scope", scope)
                .addValue("key", key)
                .addValue("requestHash", requestHash)
                .addValue("traceId", traceId)
                .addValue("correlationId", principal.correlationId()));
        if (inserted == 1) {
            return new Reservation(reservationId, false, null, null, null, null);
        }
        List<ReservationRow> rows = jdbc.query("""
                select id, request_hash, status, resource_type, resource_id,
                       response_status, response_snapshot::text
                from command_idempotency_record
                where tenant_id = :tenantId and command_scope = :scope and idempotency_key = :key
                for update
                """, base(principal).addValue("scope", scope).addValue("key", key),
                (rs, rowNum) -> new ReservationRow(
                        rs.getObject("id", UUID.class), rs.getString("request_hash"), rs.getString("status"),
                        rs.getString("resource_type"), rs.getObject("resource_id", UUID.class),
                        (Integer) rs.getObject("response_status"), rs.getString("response_snapshot")));
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等命令状态不可用");
        }
        ReservationRow existing = rows.getFirst();
        if (!existing.requestHash().equals(requestHash)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "相同Idempotency-Key对应了不同请求");
        }
        if ("SUCCEEDED".equals(existing.status())) {
            return new Reservation(existing.id(), true, existing.resourceType(), existing.resourceId(),
                    existing.responseStatus(), parse(existing.responseSnapshot()));
        }
        if ("FAILED".equals(existing.status())) {
            jdbc.update("""
                    update command_idempotency_record
                    set status = 'IN_PROGRESS', last_error = null, response_status = null,
                        response_snapshot = '{}'::jsonb, resource_type = null, resource_id = null,
                        row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", existing.id()));
            return new Reservation(existing.id(), false, null, null, null, null);
        }
        throw new ResponseStatusException(HttpStatus.CONFLICT, "相同幂等命令正在处理中");
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public void succeed(
            Reservation reservation,
            String resourceType,
            UUID resourceId,
            int responseStatus,
            Object response
    ) {
        if (reservation.replayed()) return;
        TenantPrincipal principal = prepare();
        int changed = jdbc.update("""
                update command_idempotency_record
                set status = 'SUCCEEDED', resource_type = :resourceType, resource_id = :resourceId,
                    response_status = :responseStatus, response_snapshot = cast(:response as jsonb),
                    last_error = null, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and status = 'IN_PROGRESS'
                """, base(principal)
                .addValue("id", reservation.id())
                .addValue("resourceType", resourceType)
                .addValue("resourceId", resourceId)
                .addValue("responseStatus", responseStatus)
                .addValue("response", canonical(response)));
        if (changed != 1) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等命令已被其他请求完成或失效");
        }
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String canonical(Object value) {
        try {
            JsonNode tree = value instanceof JsonNode node ? node : objectMapper.valueToTree(value);
            return objectMapper.writeValueAsString(tree == null ? objectMapper.createObjectNode() : tree);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法规范化幂等请求", exception);
        }
    }

    private JsonNode parse(String value) {
        if (value == null) return null;
        try {
            return objectMapper.readTree(value);
        } catch (Exception exception) {
            throw new IllegalStateException("已保存的幂等响应不是有效JSON", exception);
        }
    }

    private static String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256不可用", exception);
        }
    }

    private static String required(String value, String field) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(field + "不能为空");
        return value.trim();
    }

    private record ReservationRow(
            UUID id,
            String requestHash,
            String status,
            String resourceType,
            UUID resourceId,
            Integer responseStatus,
            String responseSnapshot
    ) {
    }

    public record Reservation(
            UUID id,
            boolean replayed,
            String resourceType,
            UUID resourceId,
            Integer responseStatus,
            JsonNode responseSnapshot
    ) {
    }
}
