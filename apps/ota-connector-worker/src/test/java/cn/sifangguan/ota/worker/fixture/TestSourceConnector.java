package cn.sifangguan.ota.worker.fixture;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ConfigValidationResult;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.ConnectionTestResult;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorCapabilityRequirement;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.NonSecretConnectorConfig;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.time.Instant;
import java.util.Set;
import java.util.function.Function;

public final class TestSourceConnector implements SourceConnector {
    private ConnectorDescriptor descriptor;
    private final Function<CollectionRequest, CollectionResult> collector;

    public TestSourceConnector(String code, Function<CollectionRequest, CollectionResult> collector) {
        this(
                new ConnectorDescriptor(
                        code,
                        SourceSystem.PMS,
                        "test-fixture-1",
                        Set.of(ConnectorCapability.BOOKING_EVENTS),
                        Set.of(DataStreamType.BOOKING_EVENT),
                        false),
                collector);
    }

    public TestSourceConnector(
            ConnectorDescriptor descriptor,
            Function<CollectionRequest, CollectionResult> collector) {
        this.descriptor = java.util.Objects.requireNonNull(
                descriptor,
                "descriptor");
        this.collector = java.util.Objects.requireNonNull(
                collector,
                "collector");
    }

    @Override
    public ConnectorDescriptor descriptor() {
        return descriptor;
    }

    public void replaceDescriptorForTest(ConnectorDescriptor descriptor) {
        this.descriptor = java.util.Objects.requireNonNull(descriptor, "descriptor");
    }

    @Override
    public ConfigValidationResult validateConfig(
            NonSecretConnectorConfig config,
            ConnectorCapabilityRequirement requirement) {
        return ConfigValidationResult.pass();
    }

    @Override
    public ConnectionTestResult testConnection(ConnectionContext context) {
        return new ConnectionTestResult(ValidationState.PASS, Instant.EPOCH, "TEST_OK");
    }

    @Override
    public AuthorizationProbeResult probeAuthorization(ConnectionContext context) {
        return new AuthorizationProbeResult(AuthorizationState.AUTHORIZED, Instant.EPOCH, "TEST_OK");
    }

    @Override
    public CollectionResult collect(CollectionRequest request) {
        return collector.apply(request);
    }
}
