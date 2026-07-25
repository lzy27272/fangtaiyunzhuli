package cn.sifangguan.ota.browsersession.rehearsal;

import java.time.Instant;
import java.util.Objects;

public record ManualAuthorizationRehearsalSnapshot(
        ManualAuthorizationRehearsalIdentity identity,
        ManualAuthorizationRehearsalMode mode,
        ManualAuthorizationRehearsalState state,
        ManualAuthorizationState authorizationState,
        Instant createdAt,
        Instant changedAt,
        Instant expiresAt,
        long revision) {

    public ManualAuthorizationRehearsalSnapshot {
        Objects.requireNonNull(identity, "identity");
        Objects.requireNonNull(mode, "mode");
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(authorizationState, "authorizationState");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(changedAt, "changedAt");
        Objects.requireNonNull(expiresAt, "expiresAt");

        if (mode != ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL
                || authorizationState != ManualAuthorizationState.AUTH_REQUIRED
                || revision < 0
                || !expiresAt.isAfter(createdAt)
                || changedAt.isBefore(createdAt)
                || !hasValidLifecycleShape(state, createdAt, changedAt, expiresAt, revision)) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL);
        }
    }

    public static ManualAuthorizationRehearsalSnapshot pending(
            ManualAuthorizationRehearsalIdentity identity,
            Instant createdAt,
            Instant expiresAt) {
        return new ManualAuthorizationRehearsalSnapshot(
                identity,
                ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL,
                ManualAuthorizationRehearsalState.PENDING_HELPER,
                ManualAuthorizationState.AUTH_REQUIRED,
                createdAt,
                createdAt,
                expiresAt,
                0);
    }

    private static boolean hasValidLifecycleShape(
            ManualAuthorizationRehearsalState state,
            Instant createdAt,
            Instant changedAt,
            Instant expiresAt,
            long revision) {
        return switch (state) {
            case PENDING_HELPER ->
                    revision == 0 && changedAt.equals(createdAt);
            case WAITING_FOR_OPERATOR ->
                    revision >= 1 && changedAt.isBefore(expiresAt);
            case OFFLINE_REHEARSAL_COMPLETE ->
                    revision >= 2 && changedAt.isBefore(expiresAt);
            case CANCELLED, FAILED ->
                    revision >= 1 && changedAt.isBefore(expiresAt);
            case EXPIRED ->
                    revision >= 1 && !changedAt.isBefore(expiresAt);
        };
    }
}
