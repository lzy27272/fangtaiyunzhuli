package cn.sifangguan.ota.worker.sprint2.contract;

import java.util.Objects;

public final class ConnectorContractApprovalException extends RuntimeException {
    private final ConnectorContractApprovalReason reason;

    public ConnectorContractApprovalException(
            ConnectorContractApprovalReason reason) {
        super(Objects.requireNonNull(reason, "reason").name());
        this.reason = reason;
    }

    public ConnectorContractApprovalReason reason() {
        return reason;
    }

    public String reasonCode() {
        return reason.name();
    }
}
