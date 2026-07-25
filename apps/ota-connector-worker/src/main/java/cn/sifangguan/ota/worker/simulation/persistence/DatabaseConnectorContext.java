package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.util.Objects;
import java.util.UUID;

record DatabaseConnectorContext(
        SourceSystem source,
        UUID connectorId,
        UUID connectorVersionId,
        String parserVersion) {

    DatabaseConnectorContext {
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(connectorVersionId, "connectorVersionId");
        Objects.requireNonNull(parserVersion, "parserVersion");
        if (parserVersion.isBlank()) {
            throw new IllegalArgumentException("parserVersion must not be blank");
        }
    }
}
