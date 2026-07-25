package cn.sifangguan.ota.browsersession;

import java.util.Objects;

public final class BrowserSessionPolicyException extends IllegalArgumentException {
    private final BrowserSessionErrorCode errorCode;

    public BrowserSessionPolicyException(BrowserSessionErrorCode errorCode) {
        super(Objects.requireNonNull(errorCode, "errorCode").code());
        this.errorCode = errorCode;
    }

    public BrowserSessionErrorCode errorCode() {
        return errorCode;
    }
}
