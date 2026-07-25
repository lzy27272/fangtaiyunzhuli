package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

public final class BrowserAuthorizationRehearsalStorageException
        extends RuntimeException {
    public BrowserAuthorizationRehearsalStorageException(Throwable cause) {
        super("Offline browser authorization rehearsal storage is unavailable",
                cause);
    }
}
