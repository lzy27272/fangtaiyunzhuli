package cn.sifangguan.ota.browsersession.rehearsal;

import cn.sifangguan.ota.browsersession.BrowserSessionBinding;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ManualAuthorizationRehearsalStateMachineTest {
    private static final Instant CREATED_AT =
            Instant.parse("2026-07-25T04:00:00Z");
    private static final Instant EXPIRES_AT = CREATED_AT.plusSeconds(60);
    private final ManualAuthorizationRehearsalStateMachine stateMachine =
            new ManualAuthorizationRehearsalStateMachine();

    @Test
    void noTerminalStateCanBeRevived() {
        var pending = pending();
        var waiting = transition(
                pending,
                ManualAuthorizationRehearsalAction.PREPARE,
                CREATED_AT.plusSeconds(1));
        var complete = transition(
                waiting,
                ManualAuthorizationRehearsalAction.COMPLETE,
                CREATED_AT.plusSeconds(2));
        var cancelled = transition(
                pending,
                ManualAuthorizationRehearsalAction.CANCEL,
                CREATED_AT.plusSeconds(1));
        var failed = transition(
                pending,
                ManualAuthorizationRehearsalAction.FAIL,
                CREATED_AT.plusSeconds(1));
        var expired = transition(
                pending,
                ManualAuthorizationRehearsalAction.EXPIRE,
                EXPIRES_AT);

        for (var terminal : new ManualAuthorizationRehearsalSnapshot[] {
                complete, cancelled, failed, expired
        }) {
            for (var action : ManualAuthorizationRehearsalAction.values()) {
                var failure = assertThrows(
                        ManualAuthorizationRehearsalPolicyException.class,
                        () -> stateMachine.transition(
                                terminal,
                                action,
                                EXPIRES_AT.plusSeconds(1)));
                assertEquals(
                        ManualAuthorizationRehearsalErrorCode
                                .INVALID_TRANSITION,
                        failure.errorCode());
            }
        }
    }

    @Test
    void enforcesMonotonicTimeAndDeadlineSemantics() {
        var pending = pending();
        var waiting = transition(
                pending,
                ManualAuthorizationRehearsalAction.PREPARE,
                CREATED_AT.plusSeconds(10));

        assertFailure(
                ManualAuthorizationRehearsalErrorCode.NON_MONOTONIC_TIME,
                () -> stateMachine.transition(
                        waiting,
                        ManualAuthorizationRehearsalAction.COMPLETE,
                        CREATED_AT.plusSeconds(9)));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.DEADLINE_REACHED,
                () -> stateMachine.transition(
                        pending,
                        ManualAuthorizationRehearsalAction.PREPARE,
                        EXPIRES_AT));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.DEADLINE_NOT_REACHED,
                () -> stateMachine.transition(
                        pending,
                        ManualAuthorizationRehearsalAction.EXPIRE,
                        EXPIRES_AT.minusNanos(1)));

        assertEquals(
                ManualAuthorizationRehearsalState.EXPIRED,
                stateMachine.transition(
                        waiting,
                        ManualAuthorizationRehearsalAction.EXPIRE,
                        EXPIRES_AT).state());
    }

    @Test
    void rejectsCompletionBeforeTheOperatorWaitingState() {
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.INVALID_TRANSITION,
                () -> stateMachine.transition(
                        pending(),
                        ManualAuthorizationRehearsalAction.COMPLETE,
                        CREATED_AT.plusSeconds(1)));
    }

    @Test
    void snapshotRejectsShapesThatCouldClaimAnInvalidLifecycle() {
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL,
                () -> new ManualAuthorizationRehearsalSnapshot(
                        identity(),
                        ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL,
                        ManualAuthorizationRehearsalState
                                .OFFLINE_REHEARSAL_COMPLETE,
                        ManualAuthorizationState.AUTH_REQUIRED,
                        CREATED_AT,
                        CREATED_AT.plusSeconds(1),
                        EXPIRES_AT,
                        1));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL,
                () -> ManualAuthorizationRehearsalSnapshot.pending(
                        identity(),
                        CREATED_AT,
                        CREATED_AT));
    }

    private ManualAuthorizationRehearsalSnapshot transition(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalAction action,
            Instant occurredAt) {
        return stateMachine.transition(current, action, occurredAt);
    }

    private ManualAuthorizationRehearsalSnapshot pending() {
        return ManualAuthorizationRehearsalSnapshot.pending(
                identity(),
                CREATED_AT,
                EXPIRES_AT);
    }

    private ManualAuthorizationRehearsalIdentity identity() {
        return new ManualAuthorizationRehearsalIdentity(
                UUID.fromString("57469985-1048-4e47-a8d5-18b5941f8a63"),
                new BrowserSessionBinding(
                        "tenant-1",
                        "hotel-1",
                        "connector-1",
                        "1.0.0",
                        "config-7",
                        "actor-1",
                        UUID.fromString(
                                "a19ecbe7-3d99-42c9-a45d-8faf266bbbfb")));
    }

    private void assertFailure(
            ManualAuthorizationRehearsalErrorCode expected,
            Runnable invocation) {
        var failure = assertThrows(
                ManualAuthorizationRehearsalPolicyException.class,
                invocation::run);
        assertEquals(expected, failure.errorCode());
        assertEquals(expected.code(), failure.getMessage());
    }
}
