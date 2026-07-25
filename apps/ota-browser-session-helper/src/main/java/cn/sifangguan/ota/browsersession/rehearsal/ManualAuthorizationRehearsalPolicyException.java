package cn.sifangguan.ota.browsersession.rehearsal;

import java.util.Objects;

public final class ManualAuthorizationRehearsalPolicyException
        extends IllegalArgumentException {
    private final ManualAuthorizationRehearsalErrorCode errorCode;

    public ManualAuthorizationRehearsalPolicyException(
            ManualAuthorizationRehearsalErrorCode errorCode) {
        super(Objects.requireNonNull(errorCode, "errorCode").code());
        this.errorCode = errorCode;
    }

    public ManualAuthorizationRehearsalErrorCode errorCode() {
        return errorCode;
    }
}
