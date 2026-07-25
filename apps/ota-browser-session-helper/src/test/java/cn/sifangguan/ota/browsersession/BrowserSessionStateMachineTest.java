package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class BrowserSessionStateMachineTest {
    private final BrowserSessionStateMachine stateMachine =
            new BrowserSessionStateMachine();
    private final Instant createdAt = Instant.parse("2026-07-25T04:00:00Z");

    @Test
    void followsInteractiveLoginExpiryReauthenticationAndRevocationLifecycle() {
        var pending = BrowserSessionSnapshot.pending(binding(), createdAt);
        var active = stateMachine.transition(
                pending,
                BrowserSessionEvent.INTERACTIVE_LOGIN_CONFIRMED,
                createdAt.plusSeconds(1));
        var expiring = stateMachine.transition(
                active,
                BrowserSessionEvent.EXPIRY_WINDOW_ENTERED,
                createdAt.plusSeconds(2));
        var reauthRequired = stateMachine.transition(
                expiring,
                BrowserSessionEvent.AUTHENTICATION_REJECTED,
                createdAt.plusSeconds(3));
        var pendingAgain = stateMachine.transition(
                reauthRequired,
                BrowserSessionEvent.INTERACTIVE_REAUTH_REQUESTED,
                createdAt.plusSeconds(4));
        var revoked = stateMachine.transition(
                pendingAgain,
                BrowserSessionEvent.REVOKE_REQUESTED,
                createdAt.plusSeconds(5));

        assertEquals(BrowserSessionState.ACTIVE, active.state());
        assertEquals(BrowserSessionState.EXPIRING, expiring.state());
        assertEquals(BrowserSessionState.REAUTH_REQUIRED, reauthRequired.state());
        assertEquals(
                BrowserSessionState.PENDING_INTERACTIVE_LOGIN,
                pendingAgain.state());
        assertEquals(BrowserSessionState.REVOKED, revoked.state());
        assertEquals(5, revoked.revision());
        assertEquals(pending.binding(), revoked.binding());
    }

    @Test
    void refusesInvalidAndNonMonotonicTransitionsWithFixedCodes() {
        var pending = BrowserSessionSnapshot.pending(binding(), createdAt);

        var invalid = assertThrows(
                BrowserSessionPolicyException.class,
                () -> stateMachine.transition(
                        pending,
                        BrowserSessionEvent.EXPIRY_WINDOW_ENTERED,
                        createdAt.plusSeconds(1)));
        var nonMonotonic = assertThrows(
                BrowserSessionPolicyException.class,
                () -> stateMachine.transition(
                        pending,
                        BrowserSessionEvent.INTERACTIVE_LOGIN_CONFIRMED,
                        createdAt.minusSeconds(1)));

        assertEquals(
                BrowserSessionErrorCode.INVALID_STATE_TRANSITION,
                invalid.errorCode());
        assertEquals(
                BrowserSessionErrorCode.NON_MONOTONIC_TRANSITION_TIME,
                nonMonotonic.errorCode());
        assertEquals(invalid.errorCode().code(), invalid.getMessage());
        assertEquals(nonMonotonic.errorCode().code(), nonMonotonic.getMessage());
    }

    @Test
    void revokedStateIsTerminal() {
        var pending = BrowserSessionSnapshot.pending(binding(), createdAt);
        var revoked = stateMachine.transition(
                pending,
                BrowserSessionEvent.REVOKE_REQUESTED,
                createdAt.plusSeconds(1));

        var exception = assertThrows(
                BrowserSessionPolicyException.class,
                () -> stateMachine.transition(
                        revoked,
                        BrowserSessionEvent.INTERACTIVE_REAUTH_REQUESTED,
                        createdAt.plusSeconds(2)));

        assertEquals(
                BrowserSessionErrorCode.INVALID_STATE_TRANSITION,
                exception.errorCode());
    }

    private BrowserSessionBinding binding() {
        return new BrowserSessionBinding(
                "tenant-1",
                "hotel-1",
                "connector-1",
                "1.0.0",
                "config-7",
                "actor-1",
                UUID.randomUUID());
    }
}
