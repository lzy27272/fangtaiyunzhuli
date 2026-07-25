package cn.sifangguan.ota.browsersession;

import java.util.Objects;
import java.util.Optional;

public record BrowserTargetAuthorization(
        boolean allowed,
        Optional<BrowserSessionErrorCode> denialCode) {

    public BrowserTargetAuthorization {
        Objects.requireNonNull(denialCode, "denialCode");
        if (allowed == denialCode.isPresent()) {
            throw new IllegalArgumentException(
                    "allowed decisions cannot have a denial code");
        }
    }

    public static BrowserTargetAuthorization permit() {
        return new BrowserTargetAuthorization(true, Optional.empty());
    }

    public static BrowserTargetAuthorization denied(BrowserSessionErrorCode errorCode) {
        return new BrowserTargetAuthorization(false, Optional.of(errorCode));
    }
}
