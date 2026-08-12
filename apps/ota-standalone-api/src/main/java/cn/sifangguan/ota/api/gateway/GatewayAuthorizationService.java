package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.contracts.gateway.GatewayErrorCode;
import cn.sifangguan.ota.contracts.gateway.GatewayScope;

import java.util.Objects;

/** Every hotel action requires both a role permission and an active server-side hotel scope. */
public final class GatewayAuthorizationService {
    private final StoreScopeAuthorizationPort storeScopes;

    public GatewayAuthorizationService(StoreScopeAuthorizationPort storeScopes) {
        this.storeScopes = Objects.requireNonNull(storeScopes, "storeScopes");
    }

    public void require(
            TrustedAuthorizationContext authorization,
            GatewayScope scope,
            GatewayAction action
    ) {
        Objects.requireNonNull(authorization, "authorization");
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(action, "action");
        if (!authorization.has(action.permission())
                || !storeScopes.hasActiveScope(
                        authorization.accountId(),
                        scope.tenantId(),
                        scope.hotelId(),
                        action.hotelScopeType())) {
            throw new GatewayAdmissionException(
                    GatewayErrorCode.FORBIDDEN_SCOPE,
                    "The authenticated account is not authorized for this hotel action");
        }
    }
}
