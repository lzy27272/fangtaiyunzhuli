package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestConnectorContractExecutionPreflight;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RegisteredConnectorJobExecutorTest {
    private final Clock clock = Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC);

    @Test
    void dispatchesAClaimToItsRegisteredConnector() {
        var connector = new TestSourceConnector("pms.fixture", ignored -> CollectionFixtures.success());
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                clock,
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());

        var outcome = executor.execute(claim("pms.fixture", Duration.ofMinutes(1)));

        assertEquals(JobExecutionStatus.RESULT_RECEIVED, outcome.status());
        assertTrue(outcome.result().isPresent());
    }

    @Test
    void refusesAnExpiredLeaseWithoutInvokingConnector() {
        var connector = new TestSourceConnector("pms.fixture", ignored -> {
            throw new AssertionError("expired job must not be invoked");
        });
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                clock,
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());

        var outcome = executor.execute(claim("pms.fixture", Duration.ZERO));

        assertEquals(JobExecutionStatus.LEASE_EXPIRED, outcome.status());
        assertEquals("JOB_LEASE_EXPIRED", outcome.sanitizedFailureCode());
    }

    @Test
    void convertsUnexpectedConnectorFailureToAStableSanitizedCode() {
        var connector = new TestSourceConnector("pms.fixture", ignored -> {
            throw new IllegalStateException("vendor response accidentally contained credential material");
        });
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                clock,
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());

        var outcome = executor.execute(claim("pms.fixture", Duration.ofMinutes(1)));

        assertEquals(JobExecutionStatus.EXECUTION_FAILED, outcome.status());
        assertEquals("CONNECTOR_UNHANDLED_FAILURE", outcome.sanitizedFailureCode());
    }

    @Test
    void failsClosedWhenConnectorIsNotRegistered() {
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of()),
                clock,
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());

        var outcome = executor.execute(claim("pms.missing", Duration.ofMinutes(1)));

        assertEquals(JobExecutionStatus.CONNECTOR_NOT_REGISTERED, outcome.status());
        assertEquals("CONNECTOR_NOT_REGISTERED", outcome.sanitizedFailureCode());
        assertTrue(outcome.result().isEmpty());
    }

    private static ClaimedCollectionJob claim(String connectorCode, Duration leaseDuration) {
        return new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                connectorCode,
                CollectionFixtures.request(),
                CollectionFixtures.NOW.plus(leaseDuration));
    }
}
