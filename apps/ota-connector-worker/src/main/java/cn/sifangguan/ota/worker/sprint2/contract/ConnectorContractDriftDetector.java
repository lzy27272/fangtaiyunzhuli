package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.Objects;

import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractDriftReason.CONNECTOR_ADAPTER_VERSION_DRIFT;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractDriftReason.CONNECTOR_CAPABILITY_DRIFT;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractDriftReason.CONNECTOR_IDENTITY_DRIFT;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractDriftReason.CONNECTOR_SCHEMA_DRIFT;

@Component
public final class ConnectorContractDriftDetector {
    private final ConnectorContractFingerprint fingerprint;

    public ConnectorContractDriftDetector() {
        this(new ConnectorContractFingerprint());
    }

    @Autowired
    public ConnectorContractDriftDetector(ConnectorContractFingerprint fingerprint) {
        this.fingerprint = Objects.requireNonNull(fingerprint, "fingerprint");
    }

    public void verify(
            ConnectorDescriptor descriptor,
            Map<String, Class<? extends StandardRecord>> schemas,
            ConnectorContractBaseline baseline) {
        Objects.requireNonNull(descriptor, "descriptor");
        Objects.requireNonNull(baseline, "baseline");
        if (!baseline.connectorCode().equals(descriptor.connectorCode())) {
            reject(CONNECTOR_IDENTITY_DRIFT);
        }
        if (!baseline.adapterVersion().equals(descriptor.adapterVersion())) {
            reject(CONNECTOR_ADAPTER_VERSION_DRIFT);
        }
        if (!baseline.capabilityFingerprint().equals(fingerprint.capabilityFingerprint(descriptor))) {
            reject(CONNECTOR_CAPABILITY_DRIFT);
        }
        final String actualSchemaFingerprint;
        try {
            actualSchemaFingerprint = fingerprint.schemaFingerprint(schemas);
        } catch (RuntimeException invalidSchema) {
            reject(CONNECTOR_SCHEMA_DRIFT);
            return;
        }
        if (!baseline.schemaFingerprint().equals(actualSchemaFingerprint)) {
            reject(CONNECTOR_SCHEMA_DRIFT);
        }
    }

    private static void reject(ConnectorContractDriftReason reason) {
        throw new ConnectorContractDriftException(reason);
    }
}
