package cn.sifangguan.ota.worker.browser;

/**
 * Sanitized fail-closed outcome for an operation that is absent from the
 * trusted browser-operation manifest.
 */
public final class BrowserOperationAdmissionException extends RuntimeException {
    public static final String REASON_CODE = "BROWSER_OPERATION_NOT_ADMITTED";

    public BrowserOperationAdmissionException() {
        super(REASON_CODE);
    }

    public String reasonCode() {
        return REASON_CODE;
    }
}
