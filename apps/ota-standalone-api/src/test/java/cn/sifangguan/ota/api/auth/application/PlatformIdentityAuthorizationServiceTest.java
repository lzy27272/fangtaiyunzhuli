package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.contracts.port.IdentityProviderPort;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class PlatformIdentityAuthorizationServiceTest {
    @Test
    void mapsOnlyFrozenPlatformRolesAndLeavesLegacyRevenueManagerUnprivileged() {
        UUID accountId = UUID.randomUUID();
        IdentityProviderPort provider = identity -> Optional.of(
                new IdentityProviderPort.IdentityAccount(
                        accountId,
                        Set.of("GENERAL_MANAGER", "REVENUE_MANAGER", "UNKNOWN_ROLE"),
                        7,
                        true));
        PlatformIdentityAuthorizationService service =
                new PlatformIdentityAuthorizationService(provider, new PlatformRoleMapper());

        var resolved = service.resolve(
                new IdentityProviderPort.ExternalIdentity("https://offline-idp.invalid", "subject-one"))
                .orElseThrow();

        assertThat(resolved.roles()).containsExactly(OtaRole.GENERAL_MANAGER);
        assertThat(resolved.ignoredRoleCount()).isEqualTo(2);
        assertThat(resolved.legacyRevenueRoleObserved()).isTrue();
        assertThat(resolved.authorization().has(OtaPermission.HOTEL_READ)).isTrue();
        assertThat(resolved.authorization().has(OtaPermission.PRICE_PREVIEW)).isTrue();
        assertThat(resolved.authorization().has(OtaPermission.PRICE_REQUEST_CREATE)).isTrue();
        assertThat(resolved.authorization().has(OtaPermission.PRICE_APPROVE_AND_SYNC)).isFalse();
        assertThat(resolved.toString()).doesNotContain(accountId.toString(), "UNKNOWN_ROLE");
    }

    @Test
    void refusesDisabledOrRolelessPlatformIdentities() {
        IdentityProviderPort disabled = identity -> Optional.of(
                new IdentityProviderPort.IdentityAccount(
                        UUID.randomUUID(), Set.of("OTA_OPERATION_MANAGER"), 1, false));
        IdentityProviderPort unsupported = identity -> Optional.of(
                new IdentityProviderPort.IdentityAccount(
                        UUID.randomUUID(), Set.of("REVENUE_MANAGER"), 1, true));

        assertThat(service(disabled).resolve(identity())).isEmpty();
        assertThat(service(unsupported).resolve(identity())).isEmpty();
    }

    @Test
    void otaOperationManagerOwnsRulesApprovalAndPolicyButNotPlatformTenantAdministration() {
        IdentityProviderPort provider = identity -> Optional.of(
                new IdentityProviderPort.IdentityAccount(
                        UUID.randomUUID(), Set.of("OTA_OPERATION_MANAGER"), 2, true));

        var authorization = service(provider).resolve(identity()).orElseThrow().authorization();

        assertThat(authorization.has(OtaPermission.ROOM_MAPPING_MANAGE)).isTrue();
        assertThat(authorization.has(OtaPermission.REVENUE_TARGET_MANAGE)).isTrue();
        assertThat(authorization.has(OtaPermission.PACE_CURVE_MANAGE)).isTrue();
        assertThat(authorization.has(OtaPermission.PRICE_APPROVE_AND_SYNC)).isTrue();
        assertThat(authorization.has(OtaPermission.ALERT_POLICY_MANAGE)).isTrue();
        assertThat(authorization.has(OtaPermission.AI_POLICY_MANAGE)).isTrue();
        assertThat(authorization.has(OtaPermission.TENANT_CONFIG_MANAGE)).isFalse();
    }

    private static PlatformIdentityAuthorizationService service(IdentityProviderPort provider) {
        return new PlatformIdentityAuthorizationService(provider, new PlatformRoleMapper());
    }

    private static IdentityProviderPort.ExternalIdentity identity() {
        return new IdentityProviderPort.ExternalIdentity(
                "https://offline-idp.invalid", "subject-two");
    }
}
