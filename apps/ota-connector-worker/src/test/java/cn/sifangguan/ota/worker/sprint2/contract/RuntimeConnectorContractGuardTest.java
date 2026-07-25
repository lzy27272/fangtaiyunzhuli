package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class RuntimeConnectorContractGuardTest {
    @Test
    void rejectsARecordSchemaOutsideTheApprovedStreamBaseline() {
        var request = CollectionFixtures.request();
        var connector = new TestSourceConnector(
                "pms.fixture",
                ignored -> CollectionFixtures.success());
        var guard = new RuntimeConnectorContractGuard(
                new SourceConnectorRegistry(List.of(connector)));
        var evidence = new EvidenceReference(
                "fixture://sprint2/schema-drift.json",
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                "application/json",
                10);
        var record = new PmsBusinessDateRecord(
                "business-date-2026-07-23",
                LocalDate.of(2026, 7, 23),
                CollectionFixtures.NOW.minusSeconds(1));
        var envelope = new StandardRecordEnvelope<>(
                UUID.randomUUID(),
                1,
                SourceSystem.PMS,
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.of(CollectionFixtures.NOW.minusSeconds(1)),
                Optional.empty(),
                CollectionFixtures.NOW,
                "record:schema-drift-0001",
                evidence,
                record);
        var result = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(envelope),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-20260723T100000Z",
                        CollectionFixtures.NOW.minusSeconds(1))),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(evidence),
                new CollectionQuality(
                        DataQualityState.FRESH,
                        CompletenessState.COMPLETE,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        List.of()),
                Optional.empty());

        var failure = assertThrows(
                ConnectorContractDriftException.class,
                () -> guard.verify(connector.descriptor(), request.stream(), result));

        assertEquals(ConnectorContractDriftReason.CONNECTOR_SCHEMA_DRIFT, failure.reason());
    }
}
