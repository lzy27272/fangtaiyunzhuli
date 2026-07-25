package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Freezes each registered connector descriptor for the lifetime of this
 * process and checks result schemas against the code-reviewed catalog.
 *
 * <p>This is a post-collection, in-process integrity gate. It is deliberately
 * not an administrator approval source and cannot detect drift across process
 * restarts. {@link RuntimeConnectorContractExecutionGuard} performs the
 * separate persisted approval check before connector invocation.</p>
 */
@Component
public final class RuntimeConnectorContractGuard {
    private final Map<BaselineKey, ConnectorContractBaseline> baselines;
    private final ConnectorContractDriftDetector detector;
    private final ApprovedStandardRecordSchemaCatalog schemaCatalog;

    public RuntimeConnectorContractGuard(SourceConnectorRegistry registry) {
        this(
                registry,
                new ConnectorContractDriftDetector(),
                new ConnectorContractFingerprint(),
                new ApprovedStandardRecordSchemaCatalog());
    }

    @Autowired
    public RuntimeConnectorContractGuard(
            SourceConnectorRegistry registry,
            ConnectorContractDriftDetector detector,
            ConnectorContractFingerprint fingerprint,
            ApprovedStandardRecordSchemaCatalog schemaCatalog) {
        Objects.requireNonNull(registry, "registry");
        this.detector = Objects.requireNonNull(detector, "detector");
        this.schemaCatalog = Objects.requireNonNull(schemaCatalog, "schemaCatalog");
        Objects.requireNonNull(fingerprint, "fingerprint");

        var registered = new LinkedHashMap<BaselineKey, ConnectorContractBaseline>();
        for (var descriptor : registry.descriptors()) {
            for (var stream : descriptor.streams()) {
                var key = new BaselineKey(descriptor.connectorCode(), stream);
                var baseline = new ConnectorContractBaseline(
                        descriptor.connectorCode(),
                        descriptor.adapterVersion(),
                        fingerprint.capabilityFingerprint(descriptor),
                        fingerprint.schemaFingerprint(schemaCatalog.schemasFor(stream)));
                if (registered.putIfAbsent(key, baseline) != null) {
                    throw new IllegalStateException("duplicate connector contract baseline");
                }
            }
        }
        baselines = Map.copyOf(registered);
    }

    public void verify(
            ConnectorDescriptor descriptor,
            DataStreamType stream,
            CollectionResult result) {
        Objects.requireNonNull(descriptor, "descriptor");
        Objects.requireNonNull(stream, "stream");
        Objects.requireNonNull(result, "result");
        var baseline = baselines.get(new BaselineKey(descriptor.connectorCode(), stream));
        if (baseline == null) {
            throw new ConnectorContractDriftException(
                    ConnectorContractDriftReason.CONNECTOR_CAPABILITY_DRIFT);
        }
        detector.verify(descriptor, actualSchemas(stream, result), baseline);
    }

    private Map<String, Class<? extends StandardRecord>> actualSchemas(
            DataStreamType stream,
            CollectionResult result) {
        if (result.records().isEmpty()) {
            // Empty windows contain no runtime schema evidence. Descriptor drift
            // is still checked while the schema remains pinned to the allowlist.
            return schemaCatalog.schemasFor(stream);
        }
        var actual = new LinkedHashMap<String, Class<? extends StandardRecord>>();
        for (var envelope : result.records()) {
            var record = envelope.record();
            @SuppressWarnings("unchecked")
            Class<? extends StandardRecord> recordClass =
                    (Class<? extends StandardRecord>) record.getClass();
            var previous = actual.putIfAbsent(record.recordType(), recordClass);
            if (previous != null && !previous.equals(recordClass)) {
                throw new ConnectorContractDriftException(
                        ConnectorContractDriftReason.CONNECTOR_SCHEMA_DRIFT);
            }
        }
        return Map.copyOf(actual);
    }

    private record BaselineKey(String connectorCode, DataStreamType stream) {
    }
}
