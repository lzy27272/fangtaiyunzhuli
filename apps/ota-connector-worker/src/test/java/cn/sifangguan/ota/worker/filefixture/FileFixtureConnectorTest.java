package cn.sifangguan.ota.worker.filefixture;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionWindow;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorCapabilityRequirement;
import cn.sifangguan.ota.contracts.connector.ConnectorConfigFieldPolicy;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.ExportFileContext;
import cn.sifangguan.ota.contracts.connector.ExportParseRequest;
import cn.sifangguan.ota.contracts.connector.NonSecretConnectorConfig;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.worker.job.ClaimedCollectionJob;
import cn.sifangguan.ota.worker.job.JobExecutionStatus;
import cn.sifangguan.ota.worker.job.RegisteredConnectorJobExecutor;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class FileFixtureConnectorTest {
    private final Clock clock = Clock.fixed(
            BuiltInSimulationFixture.FIXED_NOW, ZoneOffset.UTC);
    private final BuiltInOfficialExportParser parser =
            new BuiltInOfficialExportParser(clock);
    private final FileFixtureConnector connector =
            new FileFixtureConnector(clock, parser);

    @Test
    void validatesOnlyTheBuiltInNoCredentialConfiguration() {
        var policy = new ConnectorConfigFieldPolicy(
                "file-fixture.v1",
                Set.of(
                        "fixtureName",
                        "fixtureScenarioCode",
                        "pollIntervalMinutes"),
                Map.of());
        var valid = new NonSecretConnectorConfig(
                UUID.randomUUID(), 1, policy,
                Map.of(
                        "fixtureScenarioCode", "BASELINE",
                        "pollIntervalMinutes", "60"));
        var configuredPath = new NonSecretConnectorConfig(
                UUID.randomUUID(), 1, policy,
                Map.of("fixtureName", "host-file-is-not-accepted"));

        assertEquals(
                ValidationState.PASS,
                connector.validateConfig(
                        valid,
                        new ConnectorCapabilityRequirement(
                                Set.of(ConnectorCapability.OFFICIAL_EXPORT_PARSE)))
                        .state());
        assertEquals(
                ValidationState.FAIL,
                connector.validateConfig(
                        configuredPath,
                        new ConnectorCapabilityRequirement(Set.of()))
                        .state());
    }

    @Test
    void validatesAndParsesTheOfficialExportFixture() {
        var request = request(DataStreamType.BUSINESS_DATE);
        var file = BuiltInOfficialExportFixture.fileContext(
                request.scope(), request.runId());

        var result = parser.parse(new ExportParseRequest(file, request));

        assertEquals(ValidationState.PASS, parser.validate(file).state());
        assertEquals(CollectionStatus.SUCCESS, result.status());
        assertEquals(CompletenessState.COMPLETE, result.quality().completeness());
        assertFalse(result.records().isEmpty());
        assertTrue(result.records().stream().allMatch(
                record -> record.sourceSystem()
                        == SourceSystem.OFFICIAL_EXPORT));
    }

    @Test
    void unavailableFixtureNeverInventsZeroOrAdvancesWatermark() {
        var request = request(DataStreamType.INVENTORY_ROOM_TYPE);
        var unavailable = new ExportFileContext(
                request.scope(),
                UUID.randomUUID(),
                new EvidenceReference(
                        "fixture://sprint1/missing",
                        "0".repeat(64),
                        BuiltInOfficialExportFixture.MEDIA_TYPE,
                        0));

        var result = parser.parse(new ExportParseRequest(
                unavailable, request));

        assertEquals(ValidationState.FAIL, parser.validate(unavailable).state());
        assertEquals(CollectionStatus.FAILED, result.status());
        assertEquals(DataQualityState.UNAVAILABLE, result.quality().dataQuality());
        assertEquals(CompletenessState.UNAVAILABLE, result.quality().completeness());
        assertTrue(result.records().isEmpty());
        assertTrue(result.candidateWatermark().isEmpty());
        assertTrue(result.sourceEffectiveAt().isEmpty());
    }

    @Test
    void executesThroughTheGenericRegisteredConnectorExecutor() {
        var request = request(DataStreamType.BUSINESS_DATE);
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                clock);
        var job = new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                FileFixtureConnector.CONNECTOR_CODE,
                request,
                BuiltInSimulationFixture.FIXED_NOW.plus(Duration.ofMinutes(1)));

        var outcome = executor.execute(job);

        assertEquals(JobExecutionStatus.RESULT_RECEIVED, outcome.status());
        assertEquals(
                CollectionStatus.SUCCESS,
                outcome.result().orElseThrow().status());
    }

    private static CollectionRequest request(DataStreamType stream) {
        var scope = new TenantHotelRef(
                UUID.fromString("10000000-0000-0000-0000-000000000099"),
                UUID.fromString("20000000-0000-0000-0000-000000000099"));
        return new CollectionRequest(
                scope,
                UUID.fromString("30000000-0000-0000-0000-000000000099"),
                1,
                UUID.fromString("40000000-0000-0000-0000-000000000099"),
                stream,
                CollectionTrigger.OFFICIAL_IMPORT,
                new CollectionWindow(
                        BuiltInSimulationFixture.CUTOFF_AT.minus(
                                Duration.ofHours(2)),
                        BuiltInSimulationFixture.CUTOFF_AT),
                Optional.empty(),
                Optional.empty(),
                BuiltInSimulationFixture.CUTOFF_AT,
                Duration.ofMinutes(2),
                new TraceContext(
                        "trace-file-fixture",
                        "correlation-file-fixture"));
    }
}
