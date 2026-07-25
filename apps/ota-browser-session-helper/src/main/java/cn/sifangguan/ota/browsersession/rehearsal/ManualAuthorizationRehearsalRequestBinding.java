package cn.sifangguan.ota.browsersession.rehearsal;

import java.util.Objects;

/**
 * Every command and query must repeat the exact identity, fixed mode and
 * expected revision of the rehearsal it addresses.
 */
public record ManualAuthorizationRehearsalRequestBinding(
        ManualAuthorizationRehearsalIdentity identity,
        ManualAuthorizationRehearsalMode mode,
        long expectedRevision) {

    public ManualAuthorizationRehearsalRequestBinding {
        Objects.requireNonNull(identity, "identity");
        Objects.requireNonNull(mode, "mode");
        if (mode != ManualAuthorizationRehearsalMode.OFFLINE_REHEARSAL
                || expectedRevision < 0) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL);
        }
    }
}
