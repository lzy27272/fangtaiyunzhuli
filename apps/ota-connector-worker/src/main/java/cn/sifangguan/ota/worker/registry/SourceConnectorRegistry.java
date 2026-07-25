package cn.sifangguan.ota.worker.registry;

import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

@Component
public final class SourceConnectorRegistry {
    private final Map<String, SourceConnector> connectorsByCode;

    public SourceConnectorRegistry(List<SourceConnector> connectors) {
        Objects.requireNonNull(connectors, "connectors");
        var registered = new LinkedHashMap<String, SourceConnector>();
        for (var connector : connectors) {
            Objects.requireNonNull(connector, "connector");
            var descriptor = Objects.requireNonNull(connector.descriptor(), "connector descriptor");
            var previous = registered.putIfAbsent(descriptor.connectorCode(), connector);
            if (previous != null) {
                throw new IllegalStateException("duplicate connector code: " + descriptor.connectorCode());
            }
        }
        this.connectorsByCode = Map.copyOf(registered);
    }

    public Optional<SourceConnector> find(String connectorCode) {
        return Optional.ofNullable(connectorsByCode.get(connectorCode));
    }

    public SourceConnector require(String connectorCode) {
        return find(connectorCode)
                .orElseThrow(() -> new ConnectorNotRegisteredException(connectorCode));
    }

    public Collection<ConnectorDescriptor> descriptors() {
        return connectorsByCode.values().stream()
                .map(SourceConnector::descriptor)
                .sorted((left, right) -> left.connectorCode().compareTo(right.connectorCode()))
                .toList();
    }
}
