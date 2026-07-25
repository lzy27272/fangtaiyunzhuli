package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.worker.filefixture.BuiltInOfficialExportParser;
import cn.sifangguan.ota.worker.filefixture.FileFixtureConnector;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.job.ClaimedCollectionJob;
import cn.sifangguan.ota.worker.job.JobExecutionStatus;
import cn.sifangguan.ota.worker.job.RegisteredConnectorJobExecutor;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidator;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RuntimeConnectorContractExecutionGuardTest {
    private static final Clock CLOCK =
            Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC);

    @Test
    void missingPersistentBaselineBlocksBeforeConnectorInvocation() {
        assertBlockedBeforeCollection(
                ignored -> Optional.empty(),
                "CONNECTOR_CONTRACT_BASELINE_MISSING");
    }

    @Test
    void baselineReadFailureIsReducedToAStableUnavailableCode() {
        assertBlockedBeforeCollection(
                ignored -> {
                    throw new IllegalStateException(
                            "database detail must never escape");
                },
                "CONNECTOR_CONTRACT_BASELINE_UNAVAILABLE");
    }

    @Test
    void revokedApprovalOrInactiveVersionBlocksBeforeConnectorInvocation() {
        var connector = connector(new AtomicInteger());
        var approved = approved(connector.descriptor());
        var revokedStates = List.of(
                copyStatus(approved, "REVOKED", "ACTIVE"),
                copyStatus(approved, "APPROVED", "RETIRED"));

        for (var revoked : revokedStates) {
            var invocations = new AtomicInteger();
            var isolatedConnector = connector(invocations);
            var outcome = executor(
                    isolatedConnector,
                    ignored -> Optional.of(revoked))
                    .execute(claim(isolatedConnector.descriptor().connectorCode()));

            assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
            assertEquals(
                    "CONNECTOR_CONTRACT_BASELINE_REVOKED",
                    outcome.sanitizedFailureCode());
            assertEquals(0, invocations.get());
            assertTrue(outcome.result().isEmpty());
        }
    }

    @Test
    void capabilityDriftAgainstPersistentApprovalBlocksBeforeCollection() {
        var invocations = new AtomicInteger();
        var connector = connector(invocations);
        var approved = approved(connector.descriptor());
        var original = connector.descriptor();
        connector.replaceDescriptorForTest(new ConnectorDescriptor(
                original.connectorCode(),
                original.sourceSystem(),
                original.adapterVersion(),
                java.util.Set.of(
                        ConnectorCapability.BOOKING_EVENTS,
                        ConnectorCapability.SOURCE_UPDATED_AT),
                original.streams(),
                original.interactiveAuthorization()));

        var outcome = executor(
                connector,
                ignored -> Optional.of(approved))
                .execute(claim(connector.descriptor().connectorCode()));

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals(
                "CONNECTOR_CAPABILITY_DRIFT",
                outcome.sanitizedFailureCode());
        assertEquals(0, invocations.get());
    }

    @Test
    void schemaDriftAgainstPersistentApprovalBlocksBeforeCollection() {
        var invocations = new AtomicInteger();
        var connector = connector(invocations);
        var approved = approved(connector.descriptor());
        var drifted = new PersistedConnectorContractApproval(
                approved.connectorCode(),
                approved.adapterVersion(),
                approved.fingerprintAlgorithm(),
                approved.capabilityFingerprint(),
                "0".repeat(64),
                approved.approvalStatus(),
                approved.connectorVersionStatus());

        var outcome = executor(
                connector,
                ignored -> Optional.of(drifted))
                .execute(claim(connector.descriptor().connectorCode()));

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals("CONNECTOR_SCHEMA_DRIFT", outcome.sanitizedFailureCode());
        assertEquals(0, invocations.get());
    }

    @Test
    void exactApprovedPersistentBaselineAllowsExistingExecutionPipeline() {
        var invocations = new AtomicInteger();
        var connector = connector(invocations);

        var outcome = executor(
                connector,
                ignored -> Optional.of(approved(connector.descriptor())))
                .execute(claim(connector.descriptor().connectorCode()));

        assertEquals(JobExecutionStatus.RESULT_RECEIVED, outcome.status());
        assertEquals(1, invocations.get());
        assertTrue(outcome.result().isPresent());
    }

    @Test
    void exactBuiltInSimulationAndFileFixtureNeverReadPersistentBaseline() {
        ApprovedConnectorContractBaselineReader forbiddenReader = ignored -> {
            throw new AssertionError(
                    "local-only connectors must not read persistent approval");
        };
        var guard = new RuntimeConnectorContractExecutionGuard(
                forbiddenReader);
        var simulation = new SimulationPmsConnector(CLOCK);
        var fileFixture = new FileFixtureConnector(
                CLOCK,
                new BuiltInOfficialExportParser(CLOCK));

        assertDoesNotThrow(() -> guard.verifyBeforeExecution(
                claim(simulation.descriptor().connectorCode()),
                simulation));
        assertDoesNotThrow(() -> guard.verifyBeforeExecution(
                claim(fileFixture.descriptor().connectorCode()),
                fileFixture));
    }

    private static void assertBlockedBeforeCollection(
            ApprovedConnectorContractBaselineReader reader,
            String expectedCode) {
        var invocations = new AtomicInteger();
        var connector = connector(invocations);

        var outcome = executor(connector, reader)
                .execute(claim(connector.descriptor().connectorCode()));

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals(expectedCode, outcome.sanitizedFailureCode());
        assertEquals(0, invocations.get());
        assertTrue(outcome.result().isEmpty());
    }

    private static RegisteredConnectorJobExecutor executor(
            TestSourceConnector connector,
            ApprovedConnectorContractBaselineReader reader) {
        var registry = new SourceConnectorRegistry(List.of(connector));
        return new RegisteredConnectorJobExecutor(
                registry,
                CLOCK,
                new CollectionResultSafetyGate(
                        registry,
                        new CollectionResultValidator(),
                        new RuntimeConnectorContractGuard(registry)),
                new RuntimeConnectorContractExecutionGuard(reader));
    }

    private static TestSourceConnector connector(
            AtomicInteger invocations) {
        return new TestSourceConnector(
                "future.external.pms",
                ignored -> {
                    invocations.incrementAndGet();
                    return CollectionFixtures.success();
                });
    }

    private static PersistedConnectorContractApproval approved(
            ConnectorDescriptor descriptor) {
        var fingerprint = new ConnectorContractFingerprint();
        var schemas = new ApprovedStandardRecordSchemaCatalog();
        return new PersistedConnectorContractApproval(
                descriptor.connectorCode(),
                descriptor.adapterVersion(),
                PersistedConnectorContractApproval
                        .SUPPORTED_FINGERPRINT_ALGORITHM,
                fingerprint.capabilityFingerprint(descriptor),
                fingerprint.schemaFingerprint(
                        schemas.schemasFor(
                                CollectionFixtures.request().stream())),
                PersistedConnectorContractApproval.APPROVED,
                PersistedConnectorContractApproval.ACTIVE);
    }

    private static PersistedConnectorContractApproval copyStatus(
            PersistedConnectorContractApproval approval,
            String approvalStatus,
            String versionStatus) {
        return new PersistedConnectorContractApproval(
                approval.connectorCode(),
                approval.adapterVersion(),
                approval.fingerprintAlgorithm(),
                approval.capabilityFingerprint(),
                approval.schemaFingerprint(),
                approvalStatus,
                versionStatus);
    }

    private static ClaimedCollectionJob claim(String connectorCode) {
        return new ClaimedCollectionJob(
                java.util.UUID.randomUUID(),
                java.util.UUID.randomUUID(),
                connectorCode,
                CollectionFixtures.request(),
                CollectionFixtures.NOW.plusSeconds(60));
    }
}
