package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

public final class BrowserAuthorizationRehearsalConflictException
        extends RuntimeException {
    private final String code;

    public BrowserAuthorizationRehearsalConflictException(String code) {
        super("Offline browser authorization rehearsal conflict");
        this.code = code;
    }

    public String code() {
        return code;
    }
}
