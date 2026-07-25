package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;

import java.time.Clock;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

public final class CrossTenantReadExecutor {
    private final EnabledTenantDirectoryPort directory;
    private final TenantContextExecutor tenantContext;
    private final AuditPort audit;
    private final Clock clock;

    public CrossTenantReadExecutor(
            EnabledTenantDirectoryPort directory,
            TenantContextExecutor tenantContext,
            AuditPort audit,
            Clock clock
    ) {
        this.directory = directory;
        this.tenantContext = tenantContext;
        this.audit = audit;
        this.clock = clock;
    }

    public <T> CrossTenantReadResult<T> read(
            TrustedAuthorizationContext authorization,
            Function<UUID, T> tenantRead,
            String correlationId
    ) {
        if (!authorization.has(OtaPermission.CROSS_TENANT_READ)) {
            audit(authorization, "DENIED", "MISSING_CROSS_TENANT_READ", correlationId, null, null);
            throw new SecurityException("Cross-tenant read permission is required");
        }
        List<UUID> tenants = directory.listEnabledTenantIds().stream()
                .distinct()
                .sorted(Comparator.comparing(UUID::toString))
                .toList();
        LinkedHashMap<UUID, T> values = new LinkedHashMap<>();
        List<CrossTenantReadResult.TenantFailure> failures = new ArrayList<>();
        for (UUID tenantId : tenants) {
            try {
                T value = tenantContext.inTenant(tenantId, true, () -> tenantRead.apply(tenantId));
                values.put(tenantId, value);
            } catch (RuntimeException exception) {
                failures.add(new CrossTenantReadResult.TenantFailure(tenantId, "TENANT_READ_FAILED"));
            }
        }
        CrossTenantReadResult.Coverage coverage = failures.isEmpty()
                ? CrossTenantReadResult.Coverage.COMPLETE
                : values.isEmpty()
                    ? CrossTenantReadResult.Coverage.UNAVAILABLE
                    : CrossTenantReadResult.Coverage.PARTIAL;
        audit(authorization,
                coverage == CrossTenantReadResult.Coverage.COMPLETE ? "SUCCEEDED"
                        : coverage == CrossTenantReadResult.Coverage.PARTIAL ? "PARTIAL" : "FAILED",
                failures.isEmpty() ? null : "TENANT_READ_FAILED", correlationId,
                coverage.name(), tenantSetHash(tenants));
        return new CrossTenantReadResult<>(coverage, values, failures);
    }

    private void audit(
            TrustedAuthorizationContext authorization,
            String outcome,
            String reason,
            String correlationId,
            String coverage,
            String conditionHash
    ) {
        audit.append(new AuditEvent(
                UUID.randomUUID(), "CROSS_TENANT_READ", authorization.accountId(), outcome,
                reason, correlationId, clock.instant(), "TENANT_COVERAGE", null,
                null, null, coverage, conditionHash));
    }

    private static String tenantSetHash(List<UUID> tenants) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (UUID tenant : tenants) {
                digest.update(tenant.toString().getBytes(StandardCharsets.US_ASCII));
                digest.update((byte) '\n');
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
