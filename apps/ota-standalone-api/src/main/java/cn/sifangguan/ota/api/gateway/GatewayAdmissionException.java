package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.contracts.gateway.GatewayErrorCode;

import java.util.Objects;

public final class GatewayAdmissionException extends RuntimeException {
    private final GatewayErrorCode code;

    public GatewayAdmissionException(GatewayErrorCode code, String message) {
        super(message);
        this.code = Objects.requireNonNull(code, "code");
    }

    public GatewayErrorCode code() {
        return code;
    }
}
