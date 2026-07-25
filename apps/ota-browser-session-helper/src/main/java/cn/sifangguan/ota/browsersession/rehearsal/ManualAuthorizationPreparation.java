package cn.sifangguan.ota.browsersession.rehearsal;

import java.util.Objects;

public record ManualAuthorizationPreparation(
        ManualAuthorizationPreparationStatus status,
        ManualAuthorizationRehearsalSnapshot snapshot) {

    public ManualAuthorizationPreparation {
        Objects.requireNonNull(status, "status");
        Objects.requireNonNull(snapshot, "snapshot");
        if (status
                        != ManualAuthorizationPreparationStatus
                                .READY_FOR_OPERATOR_REHEARSAL
                || snapshot.state()
                        != ManualAuthorizationRehearsalState
                                .WAITING_FOR_OPERATOR
                || snapshot.authorizationState()
                        != ManualAuthorizationState.AUTH_REQUIRED) {
            throw new ManualAuthorizationRehearsalPolicyException(
                    ManualAuthorizationRehearsalErrorCode.INVALID_REHEARSAL);
        }
    }
}
