package cn.sifangguan.hotelaios.shared.context;

import java.util.LinkedHashSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Effective request identity resolved by the server from trusted authentication
 * and the active IAM records in the tenant database.
 */
public final class TenantPrincipal {
    private static final Set<String> LEGACY_TENANT_ROLES = Set.of("CEO", "GROUP_ADMIN", "PLATFORM_ADMIN");

    private final UUID tenantId;
    private final UUID actorId;
    private final String roleCode;
    private final Set<String> roleCodes;
    private final Set<String> permissions;
    private final Set<UUID> orgScopes;
    private final Set<UUID> assignmentIds;
    private final boolean tenantScope;
    private final UUID correlationId;

    /**
     * Backwards-compatible constructor retained for isolated unit tests and
     * migration tooling. Runtime authentication uses the full constructor.
     */
    public TenantPrincipal(
            UUID tenantId,
            UUID actorId,
            String roleCode,
            Set<UUID> orgScopes,
            UUID correlationId
    ) {
        this(
                tenantId,
                actorId,
                roleCode,
                Set.of(roleCode),
                Set.of(),
                orgScopes,
                Set.of(),
                LEGACY_TENANT_ROLES.contains(roleCode),
                correlationId
        );
    }

    public TenantPrincipal(
            UUID tenantId,
            UUID actorId,
            String roleCode,
            Set<String> roleCodes,
            Set<String> permissions,
            Set<UUID> orgScopes,
            Set<UUID> assignmentIds,
            boolean tenantScope,
            UUID correlationId
    ) {
        this.tenantId = Objects.requireNonNull(tenantId, "tenantId");
        this.actorId = Objects.requireNonNull(actorId, "actorId");
        this.roleCode = Objects.requireNonNull(roleCode, "roleCode");
        this.roleCodes = immutable(roleCodes);
        this.permissions = immutable(permissions);
        this.orgScopes = immutable(orgScopes);
        this.assignmentIds = immutable(assignmentIds);
        this.tenantScope = tenantScope;
        this.correlationId = Objects.requireNonNull(correlationId, "correlationId");
    }

    public UUID tenantId() {
        return tenantId;
    }

    public UUID actorId() {
        return actorId;
    }

    /**
     * Compatibility accessor for existing Sprint 1 services. New code should
     * prefer roleCodes() or hasPermission().
     */
    public String roleCode() {
        return roleCode;
    }

    public Set<String> roleCodes() {
        return roleCodes;
    }

    public Set<String> permissions() {
        return permissions;
    }

    public Set<UUID> orgScopes() {
        return orgScopes;
    }

    public Set<UUID> assignmentIds() {
        return assignmentIds;
    }

    public boolean hasTenantScope() {
        return tenantScope;
    }

    public UUID correlationId() {
        return correlationId;
    }

    public boolean hasRole(String code) {
        return roleCodes.contains(code);
    }

    public boolean hasPermission(String code) {
        return permissions.contains(code);
    }

    private static <T> Set<T> immutable(Set<T> values) {
        if (values == null || values.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(new LinkedHashSet<>(values));
    }
}
