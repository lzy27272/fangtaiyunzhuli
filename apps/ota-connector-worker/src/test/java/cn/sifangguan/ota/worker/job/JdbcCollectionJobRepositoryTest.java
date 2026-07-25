package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.CollectionWindow;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.InventoryItemKind;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.sprint2.contract.RuntimeConnectorContractGuard;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidationException;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JdbcCollectionJobRepositoryTest {
    private static final Instant CUTOFF =
            Instant.parse("2026-07-23T10:00:00Z");
    private static final String EVIDENCE_SHA256 = "a".repeat(64);
    private static final UUID WORKER_ID =
            UUID.fromString("21000000-0000-4000-8000-000000000001");

    @Test
    void commitsRunThenRawAndStandardFactsBeforeCompleteCheckpoint() {
        var database = new RecordingJdbcTemplate();
        var transactionManager = new RecordingTransactionManager();
        var repository = repository(database, transactionManager);
        var fixture = fixture(
                "object://ota-evidence/collection-1",
                Optional.of(3),
                CollectionStatus.SUCCESS,
                CompletenessState.COMPLETE);

        repository.record(
                fixture.job(),
                new WorkerIdentity(WORKER_ID.toString()),
                JobExecutionOutcome.result(
                        fixture.result(),
                        CUTOFF.plusSeconds(5)),
                CUTOFF.plusSeconds(5));

        var runIndex = database.indexOf(
                "INSERT INTO ota.connector_collection_run");
        var rawIndex = database.indexOf(
                "INSERT INTO ota.source_raw_record");
        var standardIndex = database.indexOf(
                "INSERT INTO ota.source_standard_record");
        var checkpointIndex = database.indexOf(
                "committed_watermark = EXCLUDED.committed_watermark");
        var completionIndex = database.indexOf(
                "control.complete_ota_job");
        assertTrue(runIndex < rawIndex);
        assertTrue(rawIndex < standardIndex);
        assertTrue(standardIndex < checkpointIndex);
        assertTrue(checkpointIndex < completionIndex);

        var rawArguments = database.argumentsFor(
                "INSERT INTO ota.source_raw_record");
        var standardArguments = database.argumentsFor(
                "INSERT INTO ota.source_standard_record");
        assertEquals(rawArguments[2], standardArguments[4]);
        assertEquals("object://ota-evidence/collection-1", rawArguments[10]);
        assertEquals(EVIDENCE_SHA256, rawArguments[11]);
        assertEquals("parser-v2", rawArguments[12]);
        assertEquals(64, ((String) rawArguments[7]).length());
        assertEquals(64, ((String) rawArguments[13]).length());
        assertEquals(rawArguments[13], standardArguments[12]);
        assertTrue(((String) standardArguments[13])
                .contains("\"schemaVersion\":1"));
        assertTrue(((String) standardArguments[13])
                .contains("\"effectiveAvailable\":3"));
        assertFalse(((String) standardArguments[13])
                .toLowerCase()
                .contains("credential"));
        assertEquals(1, transactionManager.commits);
        assertEquals(0, transactionManager.rollbacks);
    }

    @Test
    void incompleteResultKeepsUnknownInventoryNullAndDoesNotAdvanceWatermark() {
        var database = new RecordingJdbcTemplate();
        var transactionManager = new RecordingTransactionManager();
        var repository = repository(database, transactionManager);
        var fixture = fixture(
                "fixture://sprint2/partial-collection",
                Optional.empty(),
                CollectionStatus.PARTIAL,
                CompletenessState.PARTIAL);

        repository.record(
                fixture.job(),
                new WorkerIdentity(WORKER_ID.toString()),
                JobExecutionOutcome.result(
                        fixture.result(),
                        CUTOFF.plusSeconds(5)),
                CUTOFF.plusSeconds(5));

        assertNotEquals(
                -1,
                database.indexOf("INSERT INTO ota.source_raw_record"));
        assertNotEquals(
                -1,
                database.indexOf("INSERT INTO ota.source_standard_record"));
        assertEquals(
                -1,
                database.indexOf(
                        "committed_watermark = "
                                + "EXCLUDED.committed_watermark"));
        assertNotEquals(
                -1,
                database.indexOf(
                        "last_reason_code = "
                                + "EXCLUDED.last_reason_code"));
        var standardArguments = database.argumentsFor(
                "INSERT INTO ota.source_standard_record");
        var payload = (String) standardArguments[13];
        assertTrue(payload.contains("\"effectiveAvailable\":null"));
        assertFalse(payload.contains("\"effectiveAvailable\":0"));
        assertEquals(1, transactionManager.commits);
    }

    @Test
    void bypassedValidatorCannotAdvanceCheckpointWithoutFullSuccessMatrix() {
        var fixture = fixture(
                "fixture://sprint2/defensive-checkpoint",
                Optional.of(2),
                CollectionStatus.SUCCESS,
                CompletenessState.COMPLETE);
        var base = fixture.result();
        var invalidResults = List.of(
                copyResult(
                        base,
                        Optional.empty(),
                        base.quality()),
                copyResult(
                        base,
                        base.candidateWatermark(),
                        quality(
                                DataQualityState.SUSPECT,
                                ValidationState.PASS,
                                ValidationState.PASS,
                                ValidationState.PASS)),
                copyResult(
                        base,
                        base.candidateWatermark(),
                        quality(
                                DataQualityState.RECOVERY_VERIFYING,
                                ValidationState.PASS,
                                ValidationState.PASS,
                                ValidationState.PASS)),
                copyResult(
                        base,
                        base.candidateWatermark(),
                        quality(
                                DataQualityState.FRESH,
                                ValidationState.FAIL,
                                ValidationState.PASS,
                                ValidationState.PASS)),
                copyResult(
                        base,
                        base.candidateWatermark(),
                        quality(
                                DataQualityState.FRESH,
                                ValidationState.PASS,
                                ValidationState.FAIL,
                                ValidationState.PASS)),
                copyResult(
                        base,
                        base.candidateWatermark(),
                        quality(
                                DataQualityState.FRESH,
                                ValidationState.PASS,
                                ValidationState.PASS,
                                ValidationState.FAIL)));

        for (var invalid : invalidResults) {
            var database = new RecordingJdbcTemplate();
            var transactionManager = new RecordingTransactionManager();
            var repository = repository(database, transactionManager);

            assertThrows(
                    CollectionResultValidationException.class,
                    () -> repository.record(
                            fixture.job(),
                            new WorkerIdentity(WORKER_ID.toString()),
                            JobExecutionOutcome.result(
                                    invalid,
                                    CUTOFF.plusSeconds(5)),
                            CUTOFF.plusSeconds(5)));

            assertEquals(
                    -1,
                    database.indexOf(
                            "committed_watermark = EXCLUDED.committed_watermark"));
            assertEquals(
                    -1,
                    database.indexOf(
                            "last_reason_code = EXCLUDED.last_reason_code"));
            assertEquals(-1, database.indexOf("INSERT INTO ota.connector_collection_run"));
            assertEquals(-1, database.indexOf("control.complete_ota_job"));
            assertEquals(0, transactionManager.commits);
            assertEquals(0, transactionManager.rollbacks);
        }
    }

    @Test
    void hostFileEvidenceRejectsAndRollsBackBeforeFactsOrCheckpoint() {
        var database = new RecordingJdbcTemplate();
        var transactionManager = new RecordingTransactionManager();
        var repository = repository(database, transactionManager);
        var fixture = fixture(
                "file:///C:/Users/operator/hotel-export.json",
                Optional.of(2),
                CollectionStatus.SUCCESS,
                CompletenessState.COMPLETE);

        var failure = assertThrows(
                CollectionResultValidationException.class,
                () -> repository.record(
                        fixture.job(),
                        new WorkerIdentity(WORKER_ID.toString()),
                        JobExecutionOutcome.result(
                                fixture.result(),
                                CUTOFF.plusSeconds(5)),
                        CUTOFF.plusSeconds(5)));

        assertEquals(
                "CONNECTOR_RESULT_EVIDENCE_INVALID",
                failure.reasonCode());
        assertEquals(
                -1,
                database.indexOf("INSERT INTO ota.source_raw_record"));
        assertEquals(
                -1,
                database.indexOf("INSERT INTO ota.source_standard_record"));
        assertEquals(
                -1,
                database.indexOf("INSERT INTO ota.connector_stream_checkpoint"));
        assertEquals(-1, database.indexOf("control.complete_ota_job"));
        assertEquals(0, transactionManager.commits);
        assertEquals(0, transactionManager.rollbacks);
    }

    private static JdbcCollectionJobRepository repository(
            RecordingJdbcTemplate database,
            RecordingTransactionManager transactionManager) {
        var connector = new TestSourceConnector(
                new ConnectorDescriptor(
                        "MOCK_CTRIP",
                        SourceSystem.CTRIP,
                        "test-fixture-1",
                        Set.of(ConnectorCapability.INVENTORY_BY_SELL_PRODUCT),
                        Set.of(DataStreamType.INVENTORY_SELL_PRODUCT),
                        false),
                ignored -> {
                    throw new AssertionError("repository tests do not execute connectors");
                });
        var registry = new SourceConnectorRegistry(List.of(connector));
        var safetyGate = new CollectionResultSafetyGate(
                registry,
                new CollectionResultValidator(),
                new RuntimeConnectorContractGuard(registry));
        return new JdbcCollectionJobRepository(
                database,
                new TransactionTemplate(transactionManager),
                new ObjectMapper().findAndRegisterModules(),
                safetyGate);
    }

    private static Fixture fixture(
            String evidenceReference,
            Optional<Integer> available,
            CollectionStatus status,
            CompletenessState completeness) {
        var tenantId = UUID.fromString(
                "31000000-0000-4000-8000-000000000001");
        var hotelId = UUID.fromString(
                "31000000-0000-4000-8000-000000000002");
        var connectorId = UUID.fromString(
                "31000000-0000-4000-8000-000000000003");
        var connectorVersionId = UUID.fromString(
                "31000000-0000-4000-8000-000000000004");
        var runId = UUID.fromString(
                "31000000-0000-4000-8000-000000000005");
        var request = new CollectionRequest(
                new TenantHotelRef(tenantId, hotelId),
                connectorId,
                2,
                runId,
                DataStreamType.INVENTORY_SELL_PRODUCT,
                CollectionTrigger.SCHEDULED,
                new CollectionWindow(
                        CUTOFF.minus(Duration.ofMinutes(15)),
                        CUTOFF),
                Optional.empty(),
                Optional.empty(),
                CUTOFF,
                Duration.ofMinutes(2),
                new TraceContext("trace-collection", "correlation-collection"));
        var evidence = new EvidenceReference(
                evidenceReference,
                EVIDENCE_SHA256,
                "application/json",
                128);
        var record = new InventoryAvailabilityRecord(
                "ctrip-product-1",
                "景观双床房-无早",
                InventoryItemKind.SELL_PRODUCT,
                available,
                CUTOFF.minusSeconds(30));
        var envelope = new StandardRecordEnvelope<>(
                UUID.fromString("31000000-0000-4000-8000-000000000006"),
                1,
                SourceSystem.CTRIP,
                tenantId,
                hotelId,
                connectorId,
                runId,
                DataStreamType.INVENTORY_SELL_PRODUCT,
                Optional.of(record.sourceUpdatedAt()),
                Optional.empty(),
                CUTOFF,
                "ctrip-inventory-1",
                evidence,
                record);
        var quality = new CollectionQuality(
                completeness == CompletenessState.COMPLETE
                        ? DataQualityState.FRESH
                        : DataQualityState.SUSPECT,
                completeness,
                ValidationState.PASS,
                ValidationState.PASS,
                completeness == CompletenessState.COMPLETE
                        ? ValidationState.PASS
                        : ValidationState.WARN,
                List.of());
        var watermark = status == CollectionStatus.SUCCESS
                ? Optional.of(new CollectionWatermark(
                        "SOURCE_UPDATED_AT",
                        record.sourceUpdatedAt().toString(),
                        record.sourceUpdatedAt()))
                : Optional.<CollectionWatermark>empty();
        var result = new CollectionResult(
                status,
                List.of(envelope),
                watermark,
                Optional.of(record.sourceUpdatedAt()),
                CUTOFF,
                List.of(evidence),
                quality,
                Optional.empty());
        var job = new ClaimedCollectionJob(
                UUID.fromString("31000000-0000-4000-8000-000000000007"),
                UUID.fromString("31000000-0000-4000-8000-000000000008"),
                "MOCK_CTRIP",
                connectorVersionId,
                request,
                "NORMAL",
                CUTOFF,
                1,
                2,
                CUTOFF.plus(Duration.ofMinutes(5)));
        return new Fixture(job, result);
    }

    private static CollectionResult copyResult(
            CollectionResult base,
            Optional<CollectionWatermark> watermark,
            CollectionQuality quality) {
        return new CollectionResult(
                base.status(),
                base.records(),
                watermark,
                base.sourceEffectiveAt(),
                base.observedAt(),
                base.evidenceReferences(),
                quality,
                base.error());
    }

    private static CollectionQuality quality(
            DataQualityState dataQuality,
            ValidationState pagination,
            ValidationState field,
            ValidationState capability) {
        return new CollectionQuality(
                dataQuality,
                CompletenessState.COMPLETE,
                pagination,
                field,
                capability,
                List.of());
    }

    private record Fixture(
            ClaimedCollectionJob job,
            CollectionResult result) {
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final UUID persistedRunId = UUID.fromString(
                "41000000-0000-4000-8000-000000000001");
        private final List<Call> calls = new ArrayList<>();

        @Override
        @SuppressWarnings("unchecked")
        public <T> List<T> query(
                String sql,
                RowMapper<T> rowMapper,
                Object... args) {
            calls.add(new Call(sql, args));
            if (sql.contains("INSERT INTO ota.connector_collection_run")) {
                return List.of((T) persistedRunId);
            }
            throw new AssertionError("unexpected query: " + sql);
        }

        @Override
        public <T> T queryForObject(
                String sql,
                Class<T> requiredType,
                Object... args) {
            calls.add(new Call(sql, args));
            Object value;
            if (sql.contains("set_config('app.tenant_id'")) {
                value = args[0].toString();
            } else if (sql.contains("renew_ota_job_lease")
                    || sql.contains("complete_ota_job")) {
                value = Boolean.TRUE;
            } else if (sql.contains("SELECT parser_version")) {
                value = "parser-v2";
            } else {
                throw new AssertionError("unexpected queryForObject: " + sql);
            }
            return requiredType.cast(value);
        }

        @Override
        public int update(String sql, Object... args) {
            calls.add(new Call(sql, args));
            return 1;
        }

        private int indexOf(String sqlFragment) {
            for (var index = 0; index < calls.size(); index++) {
                if (calls.get(index).sql().contains(sqlFragment)) {
                    return index;
                }
            }
            return -1;
        }

        private Object[] argumentsFor(String sqlFragment) {
            return calls.stream()
                    .filter(call -> call.sql().contains(sqlFragment))
                    .findFirst()
                    .orElseThrow()
                    .arguments();
        }
    }

    private record Call(String sql, Object[] arguments) {
    }

    private static final class RecordingTransactionManager
            implements PlatformTransactionManager {
        private int commits;
        private int rollbacks;

        @Override
        public TransactionStatus getTransaction(
                TransactionDefinition definition) {
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
            commits++;
        }

        @Override
        public void rollback(TransactionStatus status) {
            rollbacks++;
        }
    }
}
