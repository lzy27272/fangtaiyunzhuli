package cn.sifangguan.ota.browsersession.rehearsal;

import java.util.Objects;

/**
 * Pure in-memory rehearsal composition. It opens no process, file, socket,
 * credential provider or browser.
 */
public final class OfflineNoIoManualAuthorizationHelper {
    private final ManualAuthorizationRehearsalStateMachine stateMachine;

    public OfflineNoIoManualAuthorizationHelper(
            ManualAuthorizationRehearsalStateMachine stateMachine) {
        this.stateMachine = Objects.requireNonNull(stateMachine, "stateMachine");
    }

    public ManualAuthorizationPreparation prepare(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        requireAction(command, ManualAuthorizationRehearsalAction.PREPARE);
        assertBound(current, command.requestBinding());
        var waiting = stateMachine.transition(
                current,
                command.action(),
                command.occurredAt());
        return new ManualAuthorizationPreparation(
                ManualAuthorizationPreparationStatus
                        .READY_FOR_OPERATOR_REHEARSAL,
                waiting);
    }

    public ManualAuthorizationRehearsalSnapshot complete(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        return transition(
                current,
                command,
                ManualAuthorizationRehearsalAction.COMPLETE);
    }

    public ManualAuthorizationRehearsalSnapshot cancel(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        return transition(
                current,
                command,
                ManualAuthorizationRehearsalAction.CANCEL);
    }

    public ManualAuthorizationRehearsalSnapshot expire(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        return transition(
                current,
                command,
                ManualAuthorizationRehearsalAction.EXPIRE);
    }

    public ManualAuthorizationRehearsalSnapshot fail(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command) {
        return transition(
                current,
                command,
                ManualAuthorizationRehearsalAction.FAIL);
    }

    public ManualAuthorizationRehearsalView query(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalQuery query) {
        Objects.requireNonNull(query, "query");
        assertBound(current, query.requestBinding());
        return ManualAuthorizationRehearsalView.from(current);
    }

    private ManualAuthorizationRehearsalSnapshot transition(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalCommand command,
            ManualAuthorizationRehearsalAction expectedAction) {
        requireAction(command, expectedAction);
        assertBound(current, command.requestBinding());
        return stateMachine.transition(
                current,
                command.action(),
                command.occurredAt());
    }

    private void requireAction(
            ManualAuthorizationRehearsalCommand command,
            ManualAuthorizationRehearsalAction expectedAction) {
        Objects.requireNonNull(command, "command");
        if (command.action() != expectedAction) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.ACTION_MISMATCH);
        }
    }

    private void assertBound(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalRequestBinding requestBinding) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(requestBinding, "requestBinding");
        if (!current.identity().equals(requestBinding.identity())) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.SCOPE_MISMATCH);
        }
        if (current.mode() != requestBinding.mode()) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.MODE_MISMATCH);
        }
        if (current.revision() != requestBinding.expectedRevision()) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.REVISION_MISMATCH);
        }
    }
}
