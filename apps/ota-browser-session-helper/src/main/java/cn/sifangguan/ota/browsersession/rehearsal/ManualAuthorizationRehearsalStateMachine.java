package cn.sifangguan.ota.browsersession.rehearsal;

import java.time.Instant;
import java.util.Objects;

public final class ManualAuthorizationRehearsalStateMachine {
    public ManualAuthorizationRehearsalSnapshot transition(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalAction action,
            Instant occurredAt) {
        Objects.requireNonNull(current, "current");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(occurredAt, "occurredAt");

        if (current.state().isTerminal()) {
            throw failure(
                    ManualAuthorizationRehearsalErrorCode.INVALID_TRANSITION);
        }
        if (occurredAt.isBefore(current.changedAt())) {
            throw failure(
                    ManualAuthorizationRehearsalErrorCode.NON_MONOTONIC_TIME);
        }

        if (action == ManualAuthorizationRehearsalAction.EXPIRE) {
            if (occurredAt.isBefore(current.expiresAt())) {
                throw failure(
                        ManualAuthorizationRehearsalErrorCode
                                .DEADLINE_NOT_REACHED);
            }
            return next(
                    current,
                    ManualAuthorizationRehearsalState.EXPIRED,
                    occurredAt);
        }
        if (!occurredAt.isBefore(current.expiresAt())) {
            throw failure(
                    ManualAuthorizationRehearsalErrorCode.DEADLINE_REACHED);
        }

        var nextState = switch (current.state()) {
            case PENDING_HELPER -> switch (action) {
                case PREPARE ->
                        ManualAuthorizationRehearsalState.WAITING_FOR_OPERATOR;
                case CANCEL -> ManualAuthorizationRehearsalState.CANCELLED;
                case FAIL -> ManualAuthorizationRehearsalState.FAILED;
                case COMPLETE, EXPIRE -> invalidTransition();
            };
            case WAITING_FOR_OPERATOR -> switch (action) {
                case COMPLETE ->
                        ManualAuthorizationRehearsalState
                                .OFFLINE_REHEARSAL_COMPLETE;
                case CANCEL -> ManualAuthorizationRehearsalState.CANCELLED;
                case FAIL -> ManualAuthorizationRehearsalState.FAILED;
                case PREPARE, EXPIRE -> invalidTransition();
            };
            case OFFLINE_REHEARSAL_COMPLETE, CANCELLED, EXPIRED, FAILED ->
                    invalidTransition();
        };
        return next(current, nextState, occurredAt);
    }

    private ManualAuthorizationRehearsalSnapshot next(
            ManualAuthorizationRehearsalSnapshot current,
            ManualAuthorizationRehearsalState nextState,
            Instant occurredAt) {
        return new ManualAuthorizationRehearsalSnapshot(
                current.identity(),
                current.mode(),
                nextState,
                ManualAuthorizationState.AUTH_REQUIRED,
                current.createdAt(),
                occurredAt,
                current.expiresAt(),
                Math.addExact(current.revision(), 1));
    }

    private ManualAuthorizationRehearsalState invalidTransition() {
        throw failure(
                ManualAuthorizationRehearsalErrorCode.INVALID_TRANSITION);
    }

    private ManualAuthorizationRehearsalPolicyException failure(
            ManualAuthorizationRehearsalErrorCode errorCode) {
        return new ManualAuthorizationRehearsalPolicyException(errorCode);
    }
}
