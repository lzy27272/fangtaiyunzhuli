package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.connector.DataStreamType;

import java.util.Objects;
import java.util.UUID;

/**
 * Exact persisted identity of a connector contract approval.
 */
public record ConnectorContractApprovalKey(
        UUID tenantId,
        UUID hotelId,
        UUID connectorId,
        UUID connectorVersionId,
        DataStreamType stream) {
    public ConnectorContractApprovalKey {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(connectorVersionId, "connectorVersionId");
        Objects.requireNonNull(stream, "stream");
    }
}
