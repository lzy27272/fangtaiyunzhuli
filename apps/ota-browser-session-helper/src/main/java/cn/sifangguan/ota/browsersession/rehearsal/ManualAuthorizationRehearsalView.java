package cn.sifangguan.ota.browsersession.rehearsal;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A privacy-minimized status view. Exact scope validation happens before this
 * view is returned.
 */
public record ManualAuthorizationRehearsalView(
        UUID rehearsalId,
        ManualAuthorizationRehearsalMode mode,
        ManualAuthorizationRehearsalState state,
        ManualAuthorizationState authorizationState,
        Instant changedAt,
        Instant expiresAt,
        long revision) {

    public ManualAuthorizationRehearsalView {
        Objects.requireNonNull(rehearsalId, "rehearsalId");
        Objects.requireNonNull(mode, "mode");
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(authorizationState, "authorizationState");
        Objects.requireNonNull(changedAt, "changedAt");
        Objects.requireNonNull(expiresAt, "expiresAt");
        if (mode != ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL
                || authorizationState != ManualAuthorizationState.AUTH_REQUIRED
                || revision < 0) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL);
        }
    }

    public static ManualAuthorizationRehearsalView from(
            ManualAuthorizationRehearsalSnapshot snapshot) {
        Objects.requireNonNull(snapshot, "snapshot");
        return new ManualAuthorizationRehearsalView(
                snapshot.identity().rehearsalId(),
                snapshot.mode(),
                snapshot.state(),
                snapshot.authorizationState(),
                snapshot.changedAt(),
                snapshot.expiresAt(),
                snapshot.revision());
    }
}
