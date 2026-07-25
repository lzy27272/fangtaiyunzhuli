package cn.sifangguan.ota.worker.job;

import java.util.Objects;

public record WorkerIdentity(String nodeId) {
    public WorkerIdentity {
        Objects.requireNonNull(nodeId, "nodeId");
        if (nodeId.isBlank()) {
            throw new IllegalArgumentException("nodeId must not be blank");
        }
    }
}
