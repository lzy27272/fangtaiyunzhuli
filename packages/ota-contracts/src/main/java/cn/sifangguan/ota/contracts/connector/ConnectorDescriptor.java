package cn.sifangguan.ota.contracts.connector;

import java.util.Objects;
import java.util.Set;

public record ConnectorDescriptor(
        String connectorCode,
        SourceSystem sourceSystem,
        String adapterVersion,
        Set<ConnectorCapability> capabilities,
        Set<DataStreamType> streams,
        boolean interactiveAuthorization) {

    public ConnectorDescriptor {
        connectorCode = requireText(connectorCode, "connectorCode");
        Objects.requireNonNull(sourceSystem, "sourceSystem");
        adapterVersion = requireText(adapterVersion, "adapterVersion");
        capabilities = Set.copyOf(Objects.requireNonNull(capabilities, "capabilities"));
        streams = Set.copyOf(Objects.requireNonNull(streams, "streams"));
        if (capabilities.isEmpty()) {
            throw new IllegalArgumentException("capabilities must not be empty");
        }
        if (streams.isEmpty()) {
            throw new IllegalArgumentException("streams must not be empty");
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
