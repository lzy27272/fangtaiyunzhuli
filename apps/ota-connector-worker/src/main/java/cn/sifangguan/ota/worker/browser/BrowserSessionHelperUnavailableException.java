package cn.sifangguan.ota.worker.browser;

public final class BrowserSessionHelperUnavailableException extends RuntimeException {
    public static final String REASON_CODE = "BROWSER_SESSION_HELPER_NOT_ENABLED";

    public BrowserSessionHelperUnavailableException() {
        super(REASON_CODE);
    }

    public String reasonCode() {
        return REASON_CODE;
    }
}
