package cn.sifangguan.ota.browsersession;

import java.util.Objects;
import java.util.Set;

public final class ExactTargetAllowlistPolicy {
    private final Set<BrowserTarget> allowedTargets;

    public ExactTargetAllowlistPolicy(Set<BrowserTarget> allowedTargets) {
        this.allowedTargets = Set.copyOf(
                Objects.requireNonNull(allowedTargets, "allowedTargets"));
    }

    public BrowserTargetAuthorization authorize(
            BrowserSessionSnapshot current,
            BrowserHopAuthorizationRequest request) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(request, "request");

        var stateDenial = stateDenial(current.state());
        if (stateDenial != null) {
            return BrowserTargetAuthorization.denied(stateDenial);
        }
        if (!current.binding().equals(request.binding())) {
            return BrowserTargetAuthorization.denied(
                    BrowserSessionErrorCode.SESSION_SCOPE_MISMATCH);
        }
        if (!allowedTargets.contains(request.target())) {
            return BrowserTargetAuthorization.denied(
                    BrowserSessionErrorCode.TARGET_NOT_ALLOWLISTED);
        }
        if (request.resolvedAddresses().isEmpty()) {
            return BrowserTargetAuthorization.denied(
                    BrowserSessionErrorCode.RESOLVED_ADDRESS_REQUIRED);
        }
        if (request.resolvedAddresses().stream()
                .anyMatch(address -> !address.isPublicRoutable())) {
            return BrowserTargetAuthorization.denied(
                    BrowserSessionErrorCode.NON_PUBLIC_ADDRESS_FORBIDDEN);
        }
        return BrowserTargetAuthorization.permit();
    }

    private BrowserSessionErrorCode stateDenial(BrowserSessionState state) {
        return switch (state) {
            case PENDING_INTERACTIVE_LOGIN ->
                    BrowserSessionErrorCode.INTERACTIVE_LOGIN_REQUIRED;
            case ACTIVE -> null;
            case EXPIRING -> BrowserSessionErrorCode.SESSION_EXPIRING;
            case REAUTH_REQUIRED -> BrowserSessionErrorCode.REAUTH_REQUIRED;
            case REVOKED -> BrowserSessionErrorCode.SESSION_REVOKED;
        };
    }
}
