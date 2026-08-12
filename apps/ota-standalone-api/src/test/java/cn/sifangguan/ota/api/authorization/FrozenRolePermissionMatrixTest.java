package cn.sifangguan.ota.api.authorization;

import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class FrozenRolePermissionMatrixTest {
    @Test
    void storeInitiatorsCanPreviewAndRequestButCannotApproveOrManageSecrets() {
        for (OtaRole role : Set.of(
                OtaRole.OTA_OPERATION_ASSISTANT,
                OtaRole.GENERAL_MANAGER,
                OtaRole.ASSISTANT_GENERAL_MANAGER,
                OtaRole.FRONT_OFFICE_SUPERVISOR)) {
            TrustedAuthorizationContext authorization = context(role);
            assertThat(authorization.has(OtaPermission.PRICE_PREVIEW)).as(role.name()).isTrue();
            assertThat(authorization.has(OtaPermission.PRICE_REQUEST_CREATE)).as(role.name()).isTrue();
            assertThat(authorization.has(OtaPermission.PRICE_APPROVE_AND_SYNC)).as(role.name()).isFalse();
            assertThat(authorization.has(OtaPermission.SECRET_REFERENCE_MANAGE)).as(role.name()).isFalse();
        }
    }

    @Test
    void regionalManagerAndCeoRemainReadOnlyAndLegacyRevenueManagerGetsNoBusinessPermission() {
        for (OtaRole role : Set.of(OtaRole.REGIONAL_MANAGER, OtaRole.CEO)) {
            TrustedAuthorizationContext authorization = context(role);
            assertThat(authorization.has(OtaPermission.CROSS_TENANT_READ)).isTrue();
            assertThat(authorization.has(OtaPermission.PRICE_REQUEST_CREATE)).isFalse();
            assertThat(authorization.has(OtaPermission.PRICE_APPROVE_AND_SYNC)).isFalse();
        }

        TrustedAuthorizationContext legacy = context(OtaRole.REVENUE_MANAGER);
        for (OtaPermission permission : OtaPermission.values()) {
            assertThat(legacy.has(permission)).as(permission.name()).isFalse();
        }
    }

    private static TrustedAuthorizationContext context(OtaRole role) {
        return TrustedAuthorizationContext.fromCurrentAccount(new LocalAccount(
                UUID.randomUUID(),
                "offline-account",
                "Offline Account",
                AccountStatus.ACTIVE,
                1,
                Set.of(role)));
    }
}
