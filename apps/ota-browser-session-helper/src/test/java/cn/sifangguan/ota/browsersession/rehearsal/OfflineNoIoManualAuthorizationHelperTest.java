package cn.sifangguan.ota.browsersession.rehearsal;

import cn.sifangguan.ota.browsersession.BrowserSessionBinding;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class OfflineNoIoManualAuthorizationHelperTest {
    private static final Instant CREATED_AT =
            Instant.parse("2026-07-25T04:00:00Z");
    private static final Instant EXPIRES_AT = CREATED_AT.plusSeconds(300);
    private static final UUID REHEARSAL_ID = UUID.fromString(
            "57469985-1048-4e47-a8d5-18b5941f8a63");
    private static final UUID AUTHORIZATION_ATTEMPT_ID = UUID.fromString(
            "a19ecbe7-3d99-42c9-a45d-8faf266bbbfb");

    private final OfflineNoIoManualAuthorizationHelper helper =
            new OfflineNoIoManualAuthorizationHelper(
                    new ManualAuthorizationRehearsalStateMachine());

    @Test
    void preparesAndCompletesOnlyAnOfflineOperatorRehearsal() {
        var pending = pending();

        var preparation = helper.prepare(
                pending,
                command(pending, ManualAuthorizationRehearsalAction.PREPARE, 1));

        assertEquals(
                ManualAuthorizationPreparationStatus
                        .READY_FOR_OPERATOR_REHEARSAL,
                preparation.status());
        assertEquals(
                ManualAuthorizationRehearsalState.WAITING_FOR_OPERATOR,
                preparation.snapshot().state());
        assertEquals(
                ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL,
                preparation.snapshot().mode());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                preparation.snapshot().authorizationState());

        var waitingView = helper.query(
                preparation.snapshot(),
                query(preparation.snapshot()));
        assertEquals(
                ManualAuthorizationRehearsalState.WAITING_FOR_OPERATOR,
                waitingView.state());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                waitingView.authorizationState());

        var complete = helper.complete(
                preparation.snapshot(),
                command(
                        preparation.snapshot(),
                        ManualAuthorizationRehearsalAction.COMPLETE,
                        2));

        assertEquals(
                ManualAuthorizationRehearsalState
                        .OFFLINE_REHEARSAL_COMPLETE,
                complete.state());
        assertEquals(2, complete.revision());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                complete.authorizationState());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                helper.query(complete, query(complete)).authorizationState());
    }

    @Test
    void commandQueryAndCancellationRequireTheExactRehearsalBinding() {
        var pending = pending();
        var mismatches = List.of(
                new ManualAuthorizationRehearsalIdentity(
                        UUID.randomUUID(),
                        pending.identity().sessionBinding()),
                identityWith(sessionBinding(
                        "tenant-2", "hotel-1", "connector-1", "1.0.0",
                        "config-7", "actor-1", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-2", "connector-1", "1.0.0",
                        "config-7", "actor-1", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-1", "connector-2", "1.0.0",
                        "config-7", "actor-1", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-1", "connector-1", "2.0.0",
                        "config-7", "actor-1", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-1", "connector-1", "1.0.0",
                        "config-8", "actor-1", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-1", "connector-1", "1.0.0",
                        "config-7", "actor-2", AUTHORIZATION_ATTEMPT_ID)),
                identityWith(sessionBinding(
                        "tenant-1", "hotel-1", "connector-1", "1.0.0",
                        "config-7", "actor-1", UUID.randomUUID())));

        for (var mismatch : mismatches) {
            var requestBinding = new ManualAuthorizationRehearsalRequestBinding(
                    mismatch,
                    ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL,
                    pending.revision());

            assertFailure(
                    ManualAuthorizationRehearsalErrorCode.SCOPE_MISMATCH,
                    () -> helper.query(
                            pending,
                            new ManualAuthorizationRehearsalQuery(
                                    requestBinding)));
            assertFailure(
                    ManualAuthorizationRehearsalErrorCode.SCOPE_MISMATCH,
                    () -> helper.cancel(
                            pending,
                            new ManualAuthorizationRehearsalCommand(
                                    requestBinding,
                                    ManualAuthorizationRehearsalAction.CANCEL,
                                    CREATED_AT.plusSeconds(1))));
        }
    }

    @Test
    void rejectsStaleQueriesCommandsAndMethodActionSubstitution() {
        var pending = pending();
        var stale = new ManualAuthorizationRehearsalRequestBinding(
                pending.identity(),
                pending.mode(),
                pending.revision() + 1);

        assertFailure(
                ManualAuthorizationRehearsalErrorCode.REVISION_MISMATCH,
                () -> helper.query(
                        pending,
                        new ManualAuthorizationRehearsalQuery(stale)));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.REVISION_MISMATCH,
                () -> helper.cancel(
                        pending,
                        new ManualAuthorizationRehearsalCommand(
                                stale,
                                ManualAuthorizationRehearsalAction.CANCEL,
                                CREATED_AT.plusSeconds(1))));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.ACTION_MISMATCH,
                () -> helper.prepare(
                        pending,
                        command(
                                pending,
                                ManualAuthorizationRehearsalAction.CANCEL,
                                1)));
        assertFailure(
                ManualAuthorizationRehearsalErrorCode.ACTION_MISMATCH,
                () -> helper.cancel(
                        pending,
                        command(
                                pending,
                                ManualAuthorizationRehearsalAction.PREPARE,
                                1)));
    }

    @Test
    void cancellationFailureAndExpiryAreAvailableFromBothNonTerminalStates() {
        assertTerminalFromPending(
                ManualAuthorizationRehearsalAction.CANCEL,
                ManualAuthorizationRehearsalState.CANCELLED,
                CREATED_AT.plusSeconds(1));
        assertTerminalFromPending(
                ManualAuthorizationRehearsalAction.FAIL,
                ManualAuthorizationRehearsalState.FAILED,
                CREATED_AT.plusSeconds(1));
        assertTerminalFromPending(
                ManualAuthorizationRehearsalAction.EXPIRE,
                ManualAuthorizationRehearsalState.EXPIRED,
                EXPIRES_AT);

        assertTerminalFromWaiting(
                ManualAuthorizationRehearsalAction.CANCEL,
                ManualAuthorizationRehearsalState.CANCELLED,
                CREATED_AT.plusSeconds(2));
        assertTerminalFromWaiting(
                ManualAuthorizationRehearsalAction.FAIL,
                ManualAuthorizationRehearsalState.FAILED,
                CREATED_AT.plusSeconds(2));
        assertTerminalFromWaiting(
                ManualAuthorizationRehearsalAction.EXPIRE,
                ManualAuthorizationRehearsalState.EXPIRED,
                EXPIRES_AT);
    }

    private void assertTerminalFromPending(
            ManualAuthorizationRehearsalAction action,
            ManualAuthorizationRehearsalState expectedState,
            Instant occurredAt) {
        var pending = pending();
        var terminal = invoke(
                pending,
                new ManualAuthorizationRehearsalCommand(
                        requestBinding(pending),
                        action,
                        occurredAt));
        assertEquals(expectedState, terminal.state());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                terminal.authorizationState());
    }

    private void assertTerminalFromWaiting(
            ManualAuthorizationRehearsalAction action,
            ManualAuthorizationRehearsalState expectedState,
            Instant occurredAt) {
        var waiting = helper.prepare(
                pending(),
                command(
                        pending(),
                        ManualAuthorizationRehearsalAction.PREPARE,
                        1)).snapshot();
        var terminal = invoke(
                waiting,
                new ManualAuthorizationRehearsalCommand(
                        requestBinding(waiting),
                        action,
                        occurredAt));
        assertEquals(expectedState, terminal.state());
        assertEquals(
                ManualAuthorizationState.AUTH_REQUIRED,
                terminal.authorizationState());
    }

    private ManualAuthorizationRehearsalSnapshot invoke(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        return switch (command.action()) {
            case COMPLETE -> helper.complete(current, command);
            case CANCEL -> helper.cancel(current, command);
            case EXPIRE -> helper.expire(current, command);
            case FAIL -> helper.fail(current, command);
            case PREPARE -> helper.prepare(current, command).snapshot();
        };
    }

    private ManualAuthorizationRehearsalSnapshot pending() {
        return ManualAuthorizationRehearsalSnapshot.pending(
                identityWith(sessionBinding(
                        "tenant-1",
                        "hotel-1",
                        "connector-1",
                        "1.0.0",
                        "config-7",
                        "actor-1",
                        AUTHORIZATION_ATTEMPT_ID)),
                CREATED_AT,
                EXPIRES_AT);
    }

    private ManualAuthorizationRehearsalCommand command(
            ManualAuthorizationRehearsalSnapshot snapshot,
            ManualAuthorizationRehearsalAction action,
            long secondsAfterCreation) {
        return new ManualAuthorizationRehearsalCommand(
                requestBinding(snapshot),
                action,
                CREATED_AT.plusSeconds(secondsAfterCreation));
    }

    private ManualAuthorizationRehearsalQuery query(
            ManualAuthorizationRehearsalSnapshot snapshot) {
        return new ManualAuthorizationRehearsalQuery(
                requestBinding(snapshot));
    }

    private ManualAuthorizationRehearsalRequestBinding requestBinding(
            ManualAuthorizationRehearsalSnapshot snapshot) {
        return new ManualAuthorizationRehearsalRequestBinding(
                snapshot.identity(),
                snapshot.mode(),
                snapshot.revision());
    }

    private ManualAuthorizationRehearsalIdentity identityWith(
            BrowserSessionBinding binding) {
        return new ManualAuthorizationRehearsalIdentity(
                REHEARSAL_ID,
                binding);
    }

    private BrowserSessionBinding sessionBinding(
            String tenantId,
            String hotelId,
            String connectorId,
            String connectorVersion,
            String configVersion,
            String actorId,
            UUID authorizationAttemptId) {
        return new BrowserSessionBinding(
                tenantId,
                hotelId,
                connectorId,
                connectorVersion,
                configVersion,
                actorId,
                authorizationAttemptId);
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
