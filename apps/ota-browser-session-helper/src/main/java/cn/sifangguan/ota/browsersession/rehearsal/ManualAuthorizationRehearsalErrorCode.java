package cn.sifangguan.ota.browsersession.rehearsal;

public enum ManualAuthorizationRehearsalErrorCode {
    INVALID_REHEARSAL("BSH_REHEARSAL_INVALID"),
    SCOPE_MISMATCH("BSH_REHEARSAL_SCOPE_MISMATCH"),
    MODE_MISMATCH("BSH_REHEARSAL_MODE_MISMATCH"),
    REVISION_MISMATCH("BSH_REHEARSAL_REVISION_MISMATCH"),
    ACTION_MISMATCH("BSH_REHEARSAL_ACTION_MISMATCH"),
    INVALID_TRANSITION("BSH_REHEARSAL_INVALID_TRANSITION"),
    NON_MONOTONIC_TIME("BSH_REHEARSAL_NON_MONOTONIC_TIME"),
    DEADLINE_REACHED("BSH_REHEARSAL_DEADLINE_REACHED"),
    DEADLINE_NOT_REACHED("BSH_REHEARSAL_DEADLINE_NOT_REACHED");

    private final String code;

    ManualAuthorizationRehearsalErrorCode(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
