package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;

public interface SourceConnector {
    ConnectorDescriptor descriptor();

    ConfigValidationResult validateConfig(
            NonSecretConnectorConfig config,
            ConnectorCapabilityRequirement requirement);

    ConnectionTestResult testConnection(ConnectionContext context);

    AuthorizationProbeResult probeAuthorization(ConnectionContext context);

    CollectionResult collect(CollectionRequest request);
}
