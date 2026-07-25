package cn.sifangguan.ota.worker.sprint2.contract;

import java.util.Objects;

public final class ConnectorContractDriftException extends RuntimeException {
    private final ConnectorContractDriftReason reason;

    public ConnectorContractDriftException(ConnectorContractDriftReason reason) {
        super(Objects.requireNonNull(reason, "reason").name());
        this.reason = reason;
    }

    public ConnectorContractDriftReason reason() {
        return reason;
    }

    public String reasonCode() {
        return reason.name();
    }
}
