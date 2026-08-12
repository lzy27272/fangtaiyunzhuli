package cn.sifangguan.ota.api.sprint2.migration;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;

public final class CredentialMigrationService {
    private static final Pattern SAFE_CODE =
            Pattern.compile("[A-Z][A-Z0-9_]{2,63}");
    private static final Pattern PROVIDER_CODE =
            Pattern.compile("[A-Z][A-Z0-9_]{1,47}");
    private static final Pattern SHA256 =
            Pattern.compile("[A-Fa-f0-9]{64}");
    private static final Pattern PREFIXED_SHA256 =
            Pattern.compile("sha256:[A-Fa-f0-9]{64}");
    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("[A-Za-z0-9._:-]{8,200}");

    private final CredentialMigrationPort port;
    private final TenantContextExecutor tenants;
    private final AuditPort audit;
    private final Clock clock;

    public CredentialMigrationService(
            CredentialMigrationPort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock
    ) {
        this.port = Objects.requireNonNull(port, "port");
        this.tenants = Objects.requireNonNull(tenants, "tenants");
        this.audit = Objects.requireNonNull(audit, "audit");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public List<RehearsalView> list(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId
    ) {
        requireGlobalRead(account);
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        return tenants.inTenant(
                tenantId,
                true,
                () -> port.list(hotelId, connectorId));
    }

    public Receipt prepare(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            long expectedBindingRowVersion,
            String secretPurpose,
            String sourceSystemCode,
            String sourceLocatorHash,
            String targetProviderCode,
            String targetSecretVersion,
            String targetSecretFingerprint,
            String reasonCode,
            String idempotencyKey,
            String correlationId
    ) {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(connectorVersionId, "connectorVersionId");
        validate(
                expectedBindingRowVersion,
                secretPurpose,
                sourceSystemCode,
                sourceLocatorHash,
                targetProviderCode,
                targetSecretVersion,
                targetSecretFingerprint,
                reasonCode,
                idempotencyKey);
        String requestHash = sha256(String.join(
                "|",
                tenantId.toString(),
                hotelId.toString(),
                connectorId.toString(),
                connectorVersionId.toString(),
                Long.toString(expectedBindingRowVersion),
                secretPurpose,
                sourceSystemCode,
                sourceLocatorHash.toLowerCase(),
                targetProviderCode,
                targetSecretVersion,
                targetSecretFingerprint.toLowerCase(),
                reasonCode));
        requireManage(
                account,
                tenantId,
                hotelId,
                connectorId,
                requestHash,
                correlationId);
        PrepareCommand command = new PrepareCommand(
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                account.id(),
                expectedBindingRowVersion,
                secretPurpose,
                sourceSystemCode,
                sourceLocatorHash.toLowerCase(),
                targetProviderCode,
                targetSecretVersion,
                targetSecretFingerprint.toLowerCase(),
                reasonCode,
                idempotencyKey,
                requestHash);
        try {
            return tenants.inTenant(tenantId, false, () -> {
                Receipt receipt = port.prepare(command);
                audit.appendInCurrentTransaction(event(
                        account,
                        "WP2_CREDENTIAL_MIGRATION_PREPARE",
                        "SUCCEEDED",
                        null,
                        correlationId,
                        tenantId,
                        hotelId,
                        connectorId,
                        requestHash));
                return receipt;
            });
        } catch (RuntimeException failure) {
            audit.append(event(
                    account,
                    "WP2_CREDENTIAL_MIGRATION_PREPARE",
                    "FAILED",
                    "METADATA_REHEARSAL_FAILED",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    requestHash));
            throw failure;
        }
    }

    private void requireManage(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash,
            String correlationId
    ) {
        TrustedAuthorizationContext authorization =
                TrustedAuthorizationContext.fromAuthenticatedAccount(account);
        if (!account.roles().contains(OtaRole.PLATFORM_ADMIN)
                || !authorization.has(OtaPermission.CONNECTOR_CONFIG_MANAGE)
                || !authorization.has(OtaPermission.SECRET_REFERENCE_MANAGE)) {
            audit.append(event(
                    account,
                    "WP2_CREDENTIAL_MIGRATION_PREPARE",
                    "DENIED",
                    "MISSING_MIGRATION_PREP_PERMISSION",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    requestHash));
            throw new SecurityException(
                    "Platform connector and Secret reference permissions are required");
        }
    }

    private AuditEvent event(
            AccountView account,
            String eventType,
            String outcome,
            String reason,
            String correlationId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash
    ) {
        return new AuditEvent(
                UUID.randomUUID(),
                eventType,
                account.id(),
                outcome,
                reason,
                correlationId,
                clock.instant(),
                "CREDENTIAL_MIGRATION_REHEARSAL",
                connectorId,
                tenantId,
                hotelId,
                null,
                requestHash);
    }

    private static void requireGlobalRead(AccountView account) {
        Objects.requireNonNull(account, "account");
        if (account.roles().stream().noneMatch(OtaRole::hasGlobalReadAccess)) {
            throw new SecurityException("Global OTA read access is required");
        }
    }

    private static void validate(
            long expectedBindingRowVersion,
            String secretPurpose,
            String sourceSystemCode,
            String sourceLocatorHash,
            String targetProviderCode,
            String targetSecretVersion,
            String targetSecretFingerprint,
            String reasonCode,
            String idempotencyKey
    ) {
        if (expectedBindingRowVersion < 0
                || !matches(SAFE_CODE, secretPurpose)
                || !matches(SAFE_CODE, sourceSystemCode)
                || !matches(SHA256, sourceLocatorHash)
                || !matches(PROVIDER_CODE, targetProviderCode)
                || targetSecretVersion == null
                || targetSecretVersion.isBlank()
                || targetSecretVersion.length() > 96
                || !matches(PREFIXED_SHA256, targetSecretFingerprint)
                || !matches(SAFE_CODE, reasonCode)
                || !matches(IDEMPOTENCY_KEY, idempotencyKey)) {
            throw new IllegalArgumentException(
                    "Credential migration metadata is invalid");
        }
    }

    private static boolean matches(Pattern pattern, String value) {
        return value != null && pattern.matcher(value).matches();
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
