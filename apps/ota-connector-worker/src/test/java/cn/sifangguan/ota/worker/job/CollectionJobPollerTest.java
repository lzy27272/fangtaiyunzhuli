package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestConnectorContractExecutionPreflight;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class CollectionJobPollerTest {
    @Test
    void claimsExecutesPersistsAndCompletesThroughTheGenericPorts() {
        var clock = Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC);
        var connector = new TestSourceConnector(
                "FILE_FIXTURE", ignored -> CollectionFixtures.success());
        var executor = new RegisteredConnectorJobExecutor(
                new SourceConnectorRegistry(List.of(connector)),
                clock,
                TestConnectorContractExecutionPreflight
                        .allowIsolatedFixture());
        var repository = new RecordingRepository(claim());
        var worker = new WorkerIdentity(
                "21000000-0000-4000-8000-000000000001");
        try (var poller = new CollectionJobPoller(
                repository, repository, executor, worker, clock)) {
            poller.pollOnce();
        }

        assertEquals(1, repository.claimCount);
        assertEquals(1, repository.recordCount);
        assertEquals(1, repository.renewCount);
        assertEquals(
                JobExecutionStatus.RESULT_RECEIVED,
                repository.outcome.status());
        assertEquals(worker, repository.worker);
    }

    @Test
    void enforcesHardTimeoutAndPersistsOnlySanitizedTimeoutOutcome()
            throws InterruptedException {
        var interrupted = new CountDownLatch(1);
        ConnectorJobExecutionPort blockingExecutor = ignored -> {
            try {
                Thread.sleep(Duration.ofSeconds(5));
            } catch (InterruptedException expected) {
                interrupted.countDown();
                Thread.currentThread().interrupt();
            }
            return JobExecutionOutcome.result(
                    CollectionFixtures.success(),
                    CollectionFixtures.NOW);
        };
        var repository = new RecordingRepository(
                claim(Duration.ofMillis(60)),
                true);
        var worker = new WorkerIdentity(
                "21000000-0000-4000-8000-000000000001");

        try (var poller = testPoller(
                repository,
                blockingExecutor,
                worker,
                Duration.ofMillis(10))) {
            poller.pollOnce();
        }

        assertEquals(1, repository.recordCount);
        assertEquals(JobExecutionStatus.EXECUTION_TIMEOUT, repository.outcome.status());
        assertEquals("CONNECTOR_EXECUTION_TIMEOUT", repository.outcome.sanitizedFailureCode());
        assertTrue(repository.renewCount >= 1);
        assertTrue(interrupted.await(1, TimeUnit.SECONDS));
    }

    @Test
    void renewsLeaseDuringExecutionAndFencesBeforeRecording() {
        ConnectorJobExecutionPort slowExecutor = ignored -> {
            try {
                Thread.sleep(Duration.ofMillis(55));
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
                return JobExecutionOutcome.failure(
                        JobExecutionStatus.EXECUTION_FAILED,
                        "TEST_INTERRUPTED",
                        CollectionFixtures.NOW);
            }
            return JobExecutionOutcome.result(
                    CollectionFixtures.success(),
                    CollectionFixtures.NOW);
        };
        var repository = new RecordingRepository(
                claim(Duration.ofMillis(500)),
                true);
        var worker = new WorkerIdentity(
                "21000000-0000-4000-8000-000000000001");

        try (var poller = testPoller(
                repository,
                slowExecutor,
                worker,
                Duration.ofMillis(10))) {
            poller.pollOnce();
        }

        assertEquals(1, repository.recordCount);
        assertEquals(JobExecutionStatus.RESULT_RECEIVED, repository.outcome.status());
        assertTrue(repository.renewCount >= 2);
    }

    @Test
    void discardsConnectorResultWhenHeartbeatLosesTheLease()
            throws InterruptedException {
        var interrupted = new CountDownLatch(1);
        ConnectorJobExecutionPort blockingExecutor = ignored -> {
            try {
                Thread.sleep(Duration.ofSeconds(5));
            } catch (InterruptedException expected) {
                interrupted.countDown();
                Thread.currentThread().interrupt();
            }
            return JobExecutionOutcome.result(
                    CollectionFixtures.success(),
                    CollectionFixtures.NOW);
        };
        var repository = new RecordingRepository(
                claim(Duration.ofSeconds(1)),
                false);
        var worker = new WorkerIdentity(
                "21000000-0000-4000-8000-000000000001");

        try (var poller = testPoller(
                repository,
                blockingExecutor,
                worker,
                Duration.ofMillis(10))) {
            poller.pollOnce();
        }

        assertEquals(1, repository.renewCount);
        assertEquals(0, repository.recordCount);
        assertTrue(interrupted.await(1, TimeUnit.SECONDS));
    }

    private static CollectionJobPoller testPoller(
            RecordingRepository repository,
            ConnectorJobExecutionPort executor,
            WorkerIdentity worker,
            Duration heartbeatInterval) {
        return new CollectionJobPoller(
                repository,
                repository,
                executor,
                worker,
                Clock.fixed(CollectionFixtures.NOW, ZoneOffset.UTC),
                Executors.newVirtualThreadPerTaskExecutor(),
                heartbeatInterval,
                Duration.ofMinutes(10));
    }

    private static ClaimedCollectionJob claim() {
        return claim(CollectionFixtures.request().timeout());
    }

    private static ClaimedCollectionJob claim(Duration timeout) {
        var base = CollectionFixtures.request();
        var request = new CollectionRequest(
                base.scope(),
                base.connectorId(),
                base.configVersion(),
                base.runId(),
                base.stream(),
                base.trigger(),
                base.window(),
                base.committedWatermark(),
                base.businessDayContext(),
                base.cutoffAt(),
                timeout,
                base.traceContext());
        return new ClaimedCollectionJob(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "FILE_FIXTURE",
                request,
                CollectionFixtures.NOW.plus(Duration.ofMinutes(1)));
    }

    private static final class RecordingRepository
            implements CollectionJobClaimPort, CollectionJobLeasePort {
        private final ClaimedCollectionJob job;
        private int claimCount;
        private int renewCount;
        private int recordCount;
        private JobExecutionOutcome outcome;
        private WorkerIdentity worker;
        private final boolean renewResult;

        private RecordingRepository(ClaimedCollectionJob job) {
            this(job, true);
        }

        private RecordingRepository(
                ClaimedCollectionJob job,
                boolean renewResult) {
            this.job = job;
            this.renewResult = renewResult;
        }

        @Override
        public Optional<ClaimedCollectionJob> claimNext(
                WorkerIdentity worker,
                Instant now) {
            claimCount++;
            return Optional.of(job);
        }

        @Override
        public boolean renew(
                ClaimedCollectionJob job,
                WorkerIdentity worker,
                Instant now,
                Instant newExpiry) {
            renewCount++;
            return renewResult;
        }

        @Override
        public void record(
                ClaimedCollectionJob job,
                WorkerIdentity worker,
                JobExecutionOutcome outcome,
                Instant recordedAt) {
            recordCount++;
            this.worker = worker;
            this.outcome = outcome;
        }
    }
}
