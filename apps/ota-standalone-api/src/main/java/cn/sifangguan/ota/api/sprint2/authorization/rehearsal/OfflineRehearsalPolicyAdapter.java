package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.browsersession.BrowserSessionBinding;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalAction;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalCommand;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalIdentity;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalMode;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalRequestBinding;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalSnapshot;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalState;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationRehearsalStateMachine;
import cn.sifangguan.ota.browsersession.rehearsal.ManualAuthorizationState;
import cn.sifangguan.ota.browsersession.rehearsal.OfflineNoIoManualAuthorizationHelper;

import java.util.Objects;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptState;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;

/**
 * Maps API persistence models to the helper's pure, no-I/O rehearsal policy.
 */
public final class OfflineRehearsalPolicyAdapter {
    private final OfflineNoIoManualAuthorizationHelper helper;

    public OfflineRehearsalPolicyAdapter() {
        this.helper = new OfflineNoIoManualAuthorizationHelper(
                new ManualAuthorizationRehearsalStateMachine());
    }

    public void requirePrepared(StartCommand command) {
        Objects.requireNonNull(command, "command");
        ManualAuthorizationRehearsalSnapshot pending =
                ManualAuthorizationRehearsalSnapshot.pending(
                        identity(command),
                        command.requestedAt(),
                        command.expiresAt());
        var preparation = helper.prepare(
                pending,
                new ManualAuthorizationRehearsalCommand(
                        requestBinding(pending),
                        ManualAuthorizationRehearsalAction.PREPARE,
                        command.requestedAt()));
        if (preparation.snapshot().state()
                != ManualAuthorizationRehearsalState.WAITING_FOR_OPERATOR
                || preparation.snapshot().authorizationState()
                != ManualAuthorizationState.AUTH_REQUIRED) {
            throw new IllegalStateException(
                    "Offline helper did not preserve rehearsal safety");
        }
    }

    public void requireTransitionAllowed(
            StoredAttempt current,
            TransitionCommand command
    ) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(command, "command");
        if (current.state() != AttemptState.WAITING_FOR_OPERATOR) {
            throw new BrowserAuthorizationRehearsalConflictException(
                    "AUTHORIZATION_REHEARSAL_NOT_WAITING");
        }
        ManualAuthorizationRehearsalIdentity identity = identity(current);
        long helperRevision = Math.addExact(current.rowVersion(), 1);
        ManualAuthorizationRehearsalSnapshot waiting =
                new ManualAuthorizationRehearsalSnapshot(
                        identity,
                        ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL,
                        ManualAuthorizationRehearsalState.WAITING_FOR_OPERATOR,
                        ManualAuthorizationState.AUTH_REQUIRED,
                        current.requestedAt(),
                        current.changedAt(),
                        current.expiresAt(),
                        helperRevision);
        ManualAuthorizationRehearsalAction action =
                command.targetState()
                        == AttemptState.OFFLINE_REHEARSAL_COMPLETE
                        ? ManualAuthorizationRehearsalAction.COMPLETE
                        : ManualAuthorizationRehearsalAction.CANCEL;
        ManualAuthorizationRehearsalSnapshot changed = action
                == ManualAuthorizationRehearsalAction.COMPLETE
                ? helper.complete(
                waiting,
                new ManualAuthorizationRehearsalCommand(
                        requestBinding(waiting),
                        action,
                        command.changedAt()))
                : helper.cancel(
                waiting,
                new ManualAuthorizationRehearsalCommand(
                        requestBinding(waiting),
                        action,
                        command.changedAt()));
        if (changed.authorizationState()
                != ManualAuthorizationState.AUTH_REQUIRED
                || (command.targetState()
                == AttemptState.OFFLINE_REHEARSAL_COMPLETE
                && changed.state()
                != ManualAuthorizationRehearsalState
                .OFFLINE_REHEARSAL_COMPLETE)
                || (command.targetState() == AttemptState.CANCELLED
                && changed.state()
                != ManualAuthorizationRehearsalState.CANCELLED)) {
            throw new IllegalStateException(
                    "Offline helper transition violated rehearsal safety");
        }
    }

    private static ManualAuthorizationRehearsalRequestBinding requestBinding(
            ManualAuthorizationRehearsalSnapshot snapshot
    ) {
        return new ManualAuthorizationRehearsalRequestBinding(
                snapshot.identity(),
                snapshot.mode(),
                snapshot.revision());
    }

    private static ManualAuthorizationRehearsalIdentity identity(
            StartCommand command
    ) {
        return new ManualAuthorizationRehearsalIdentity(
                command.authorizationAttemptId(),
                new BrowserSessionBinding(
                        command.tenantId().toString(),
                        command.hotelId().toString(),
                        command.connectorId().toString(),
                        command.binding().connectorVersionId().toString(),
                        Long.toString(command.binding().configVersion()),
                        command.actorAccountId().toString(),
                        command.authorizationAttemptId()));
    }

    private static ManualAuthorizationRehearsalIdentity identity(
            StoredAttempt attempt
    ) {
        return new ManualAuthorizationRehearsalIdentity(
                attempt.authorizationAttemptId(),
                new BrowserSessionBinding(
                        attempt.tenantId().toString(),
                        attempt.hotelId().toString(),
                        attempt.connectorId().toString(),
                        attempt.connectorVersionId().toString(),
                        Long.toString(attempt.configVersion()),
                        attempt.actorAccountId().toString(),
                        attempt.authorizationAttemptId()));
    }
}
