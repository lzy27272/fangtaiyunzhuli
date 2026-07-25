package cn.sifangguan.ota.api.sprint2.intake;

public final class Sprint2ExternalActionBlockedException extends RuntimeException {
    public Sprint2ExternalActionBlockedException() {
        super("Sprint 2 external connector actions remain blocked");
    }
}
