package cn.sifangguan.ota.browsersession;

import java.time.Instant;
import java.util.Objects;

public final class BrowserSessionStateMachine {
    public BrowserSessionSnapshot transition(
            BrowserSessionSnapshot current,
            BrowserSessionEvent event,
            Instant occurredAt) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(event, "event");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if (occurredAt.isBefore(current.changedAt())) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.NON_MONOTONIC_TRANSITION_TIME);
        }

        var next = nextState(current.state(), event);
        return new BrowserSessionSnapshot(
                current.binding(),
                next,
                occurredAt,
                Math.addExact(current.revision(), 1));
    }

    private BrowserSessionState nextState(
            BrowserSessionState current,
            BrowserSessionEvent event) {
        if (event == BrowserSessionEvent.REVOKE_REQUESTED
                && current != BrowserSessionState.REVOKED) {
            return BrowserSessionState.REVOKED;
        }
        return switch (current) {
            case PENDING_INTERACTIVE_LOGIN -> switch (event) {
                case INTERACTIVE_LOGIN_CONFIRMED -> BrowserSessionState.ACTIVE;
                case AUTHENTICATION_REJECTED -> BrowserSessionState.REAUTH_REQUIRED;
                default -> invalidTransition();
            };
            case ACTIVE -> switch (event) {
                case EXPIRY_WINDOW_ENTERED -> BrowserSessionState.EXPIRING;
                case AUTHENTICATION_REJECTED -> BrowserSessionState.REAUTH_REQUIRED;
                default -> invalidTransition();
            };
            case EXPIRING -> switch (event) {
                case INTERACTIVE_LOGIN_CONFIRMED -> BrowserSessionState.ACTIVE;
                case AUTHENTICATION_REJECTED -> BrowserSessionState.REAUTH_REQUIRED;
                case INTERACTIVE_REAUTH_REQUESTED ->
                        BrowserSessionState.PENDING_INTERACTIVE_LOGIN;
                default -> invalidTransition();
            };
            case REAUTH_REQUIRED -> switch (event) {
                case INTERACTIVE_REAUTH_REQUESTED ->
                        BrowserSessionState.PENDING_INTERACTIVE_LOGIN;
                default -> invalidTransition();
            };
            case REVOKED -> invalidTransition();
        };
    }

    private BrowserSessionState invalidTransition() {
        throw new BrowserSessionPolicyException(
                BrowserSessionErrorCode.INVALID_STATE_TRANSITION);
    }
}
