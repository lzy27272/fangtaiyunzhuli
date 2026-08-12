package cn.sifangguan.ota.api.authorization;

import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.application.AccountView;

import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public final class TrustedAuthorizationContext {
    private final UUID accountId;
    private final Set<OtaRole> roles;
    private final Set<OtaPermission> permissions;

    private TrustedAuthorizationContext(UUID accountId, Set<OtaRole> roles, Set<OtaPermission> permissions) {
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.roles = Set.copyOf(roles);
        this.permissions = Set.copyOf(permissions);
    }

    public static TrustedAuthorizationContext fromCurrentAccount(LocalAccount account) {
        return fromAuthenticatedAccount(account.id(), account.roles());
    }

    public static TrustedAuthorizationContext fromAuthenticatedAccount(AccountView account) {
        Objects.requireNonNull(account, "account");
        return fromAuthenticatedAccount(account.id(), account.roles());
    }

    public static TrustedAuthorizationContext fromMappedPlatformIdentity(
            UUID accountId,
            Set<OtaRole> roles
    ) {
        Objects.requireNonNull(accountId, "accountId");
        Objects.requireNonNull(roles, "roles");
        return fromAuthenticatedAccount(accountId, roles);
    }

    private static TrustedAuthorizationContext fromAuthenticatedAccount(
            UUID accountId,
            Set<OtaRole> roles
    ) {
        EnumSet<OtaPermission> permissions = EnumSet.noneOf(OtaPermission.class);
        if (roles.stream().anyMatch(OtaRole::hasGlobalReadAccess)) {
            permissions.add(OtaPermission.CROSS_TENANT_READ);
        }
        if (roles.stream().anyMatch(role -> !role.isUnsupportedLegacyRole())) {
            permissions.add(OtaPermission.HOTEL_READ);
        }
        if (roles.contains(OtaRole.PLATFORM_ADMIN)) {
            permissions.add(OtaPermission.TENANT_CONFIG_MANAGE);
            permissions.add(OtaPermission.HOTEL_CONFIG_MANAGE);
            permissions.add(OtaPermission.CONNECTOR_CONFIG_MANAGE);
            permissions.add(OtaPermission.CONNECTOR_AUTHORIZATION_MANAGE);
            permissions.add(OtaPermission.ROOM_MAPPING_MANAGE);
            permissions.add(OtaPermission.REVENUE_TARGET_MANAGE);
            permissions.add(OtaPermission.PACE_CURVE_MANAGE);
            permissions.add(OtaPermission.SECRET_REFERENCE_MANAGE);
            permissions.add(OtaPermission.SIMULATION_RUN_TRIGGER);
        }
        if (roles.contains(OtaRole.OTA_OPERATION_MANAGER)) {
            permissions.add(OtaPermission.ROOM_MAPPING_MANAGE);
            permissions.add(OtaPermission.REVENUE_TARGET_MANAGE);
            permissions.add(OtaPermission.PACE_CURVE_MANAGE);
            permissions.add(OtaPermission.PRICE_APPROVE_AND_SYNC);
            permissions.add(OtaPermission.SECRET_REFERENCE_MANAGE);
            permissions.add(OtaPermission.ALERT_POLICY_MANAGE);
            permissions.add(OtaPermission.AI_POLICY_MANAGE);
        }
        if (roles.stream().anyMatch(OtaRole::mayInitiatePriceRequest)) {
            permissions.add(OtaPermission.PRICE_PREVIEW);
            permissions.add(OtaPermission.PRICE_REQUEST_CREATE);
        }
        return new TrustedAuthorizationContext(accountId, roles, permissions);
    }

    public UUID accountId() {
        return accountId;
    }

    public Set<OtaRole> roles() {
        return roles;
    }

    public boolean has(OtaPermission permission) {
        return permissions.contains(permission);
    }
}
