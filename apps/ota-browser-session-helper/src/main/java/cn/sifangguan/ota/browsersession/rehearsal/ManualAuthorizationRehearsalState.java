package cn.sifangguan.ota.browsersession.rehearsal;

public enum ManualAuthorizationRehearsalState {
    PENDING_HELPER,
    WAITING_FOR_OPERATOR,
    OFFLINE_REHEARSAL_COMPLETE,
    CANCELLED,
    EXPIRED,
    FAILED;

    public boolean isTerminal() {
        return switch (this) {
            case PENDING_HELPER, WAITING_FOR_OPERATOR -> false;
            case OFFLINE_REHEARSAL_COMPLETE, CANCELLED, EXPIRED, FAILED -> true;
        };
    }
}
