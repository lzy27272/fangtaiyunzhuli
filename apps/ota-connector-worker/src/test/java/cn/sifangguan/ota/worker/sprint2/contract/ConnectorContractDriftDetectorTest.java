package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ConnectorContractDriftDetectorTest {
    private final ConnectorContractFingerprint fingerprint = new ConnectorContractFingerprint();
    private final ConnectorContractDriftDetector detector =
            new ConnectorContractDriftDetector(fingerprint);

    @Test
    void matchingBaselinePassesAndFingerprintingIsOrderIndependent() {
        var descriptor = descriptor(
                "v1",
                Set.of(
                        ConnectorCapability.BOOKING_EVENTS,
                        ConnectorCapability.PMS_BUSINESS_DATE));
        Map<String, Class<? extends StandardRecord>> schemas = new LinkedHashMap<>();
        schemas.put("z_record.v1", AlternateRecord.class);
        schemas.put("pms_business_date.v1", PmsBusinessDateRecord.class);
        Map<String, Class<? extends StandardRecord>> reverse = new LinkedHashMap<>();
        reverse.put("pms_business_date.v1", PmsBusinessDateRecord.class);
        reverse.put("z_record.v1", AlternateRecord.class);
        var baseline = baseline(descriptor, schemas);

        assertEquals(
                fingerprint.schemaFingerprint(schemas),
                fingerprint.schemaFingerprint(reverse));
        assertDoesNotThrow(() -> detector.verify(descriptor, reverse, baseline));
    }

    @Test
    void adapterVersionDriftFailsClosed() {
        var descriptor = descriptor("v1", Set.of(ConnectorCapability.BOOKING_EVENTS));
        var schemas = Map.<String, Class<? extends StandardRecord>>of(
                "pms_business_date.v1", PmsBusinessDateRecord.class);
        var baseline = new ConnectorContractBaseline(
                descriptor.connectorCode(),
                "v0",
                fingerprint.capabilityFingerprint(descriptor),
                fingerprint.schemaFingerprint(schemas));

        assertDrift(
                descriptor,
                schemas,
                baseline,
                ConnectorContractDriftReason.CONNECTOR_ADAPTER_VERSION_DRIFT);
    }

    @Test
    void capabilityDriftFailsClosed() {
        var approved = descriptor("v1", Set.of(ConnectorCapability.BOOKING_EVENTS));
        var actual = descriptor(
                "v1",
                Set.of(
                        ConnectorCapability.BOOKING_EVENTS,
                        ConnectorCapability.PMS_BUSINESS_DATE));
        var schemas = Map.<String, Class<? extends StandardRecord>>of(
                "pms_business_date.v1", PmsBusinessDateRecord.class);

        assertDrift(
                actual,
                schemas,
                baseline(approved, schemas),
                ConnectorContractDriftReason.CONNECTOR_CAPABILITY_DRIFT);
    }

    @Test
    void schemaDriftFailsClosed() {
        var descriptor = descriptor("v1", Set.of(ConnectorCapability.BOOKING_EVENTS));
        var approved = Map.<String, Class<? extends StandardRecord>>of(
                "pms_business_date.v1", PmsBusinessDateRecord.class);
        var actual = Map.<String, Class<? extends StandardRecord>>of(
                "alternate_record.v1", AlternateRecord.class);

        assertDrift(
                descriptor,
                actual,
                baseline(descriptor, approved),
                ConnectorContractDriftReason.CONNECTOR_SCHEMA_DRIFT);
    }

    private void assertDrift(
            ConnectorDescriptor descriptor,
            Map<String, Class<? extends StandardRecord>> schemas,
            ConnectorContractBaseline baseline,
            ConnectorContractDriftReason expected) {
        var failure = assertThrows(
                ConnectorContractDriftException.class,
                () -> detector.verify(descriptor, schemas, baseline));
        assertEquals(expected, failure.reason());
        assertEquals(expected.name(), failure.getMessage());
    }

    private ConnectorContractBaseline baseline(
            ConnectorDescriptor descriptor,
            Map<String, Class<? extends StandardRecord>> schemas) {
        return new ConnectorContractBaseline(
                descriptor.connectorCode(),
                descriptor.adapterVersion(),
                fingerprint.capabilityFingerprint(descriptor),
                fingerprint.schemaFingerprint(schemas));
    }

    private static ConnectorDescriptor descriptor(
            String version,
            Set<ConnectorCapability> capabilities) {
        return new ConnectorDescriptor(
                "pms.real",
                SourceSystem.PMS,
                version,
                capabilities,
                Set.of(DataStreamType.BOOKING_EVENT),
                false);
    }

    private record AlternateRecord(String sourceRecordKey, Instant sourceUpdatedAt)
            implements StandardRecord {
        @Override
        public String recordType() {
            return "alternate_record.v1";
        }
    }
}
