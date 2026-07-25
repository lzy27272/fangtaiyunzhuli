package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestConnectorContractExecutionPreflight;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidator;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RegisteredConnectorJobExecutorValidationTest {
    @Test
    void reducesAnInvalidConnectorResultToAFixedSanitizedFailureCode() {
        var invalid = new CollectionResult(
                CollectionStatus.PARTIAL,
                List.of(),
                Optional.empty(),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(),
                new CollectionQuality(
                        DataQualityState.FRESH,
                        CompletenessState.COMPLETE,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        List.of()),
                Optional.empty());
        var connector = new TestSourceConnector("pms.fixture", ignored -> invalid);
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC),
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());
        var request = CollectionFixtures.request();
        var claim = new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "pms.fixture",
                request,
                CollectionFixtures.NOW.plusSeconds(60));

        var outcome = executor.execute(claim);

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals(
                "CONNECTOR_RESULT_STATUS_QUALITY_INVALID",
                outcome.sanitizedFailureCode());
        assertTrue(outcome.result().isEmpty());
    }

    @Test
    void executesRegistrationTimeContractDriftGuardOnEveryCollection() {
        var connector = new TestSourceConnector(
                "pms.fixture",
                ignored -> CollectionFixtures.success());
        var registry = new SourceConnectorRegistry(List.of(connector));
        var executor = new RegisteredConnectorJobExecutor(
                registry,
                Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC),
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());
        var approved = connector.descriptor();
        connector.replaceDescriptorForTest(new ConnectorDescriptor(
                approved.connectorCode(),
                approved.sourceSystem(),
                "unapproved-adapter-version",
                approved.capabilities(),
                approved.streams(),
                approved.interactiveAuthorization()));
        var request = CollectionFixtures.request();
        var claim = new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "pms.fixture",
                request,
                CollectionFixtures.NOW.plusSeconds(60));

        var outcome = executor.execute(claim);

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals("CONNECTOR_ADAPTER_VERSION_DRIFT", outcome.sanitizedFailureCode());
        assertTrue(outcome.result().isEmpty());
    }

    @Test
    void rejectsConnectorControlledFutureTimeAgainstExecutorClock() {
        var future = CollectionFixtures.NOW
                .plus(CollectionResultValidator.TRUSTED_CLOCK_SKEW_TOLERANCE)
                .plusSeconds(1);
        var futureResult = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-future",
                        future)),
                Optional.of(future),
                future,
                List.of(),
                new CollectionQuality(
                        DataQualityState.FRESH,
                        CompletenessState.COMPLETE,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        List.of()),
                Optional.empty());
        var connector = new TestSourceConnector("pms.fixture", ignored -> futureResult);
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC),
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());
        var request = CollectionFixtures.request();
        var claim = new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "pms.fixture",
                request,
                CollectionFixtures.NOW.plusSeconds(60));

        var outcome = executor.execute(claim);

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals(
                "CONNECTOR_RESULT_TRUSTED_TIME_INVALID",
                outcome.sanitizedFailureCode());
        assertTrue(outcome.result().isEmpty());
    }
}
