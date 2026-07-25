package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

public final class BrowserAuthorizationRehearsalNotFoundException
        extends RuntimeException {
    public BrowserAuthorizationRehearsalNotFoundException() {
        super("Offline browser authorization rehearsal was not found");
    }
}
