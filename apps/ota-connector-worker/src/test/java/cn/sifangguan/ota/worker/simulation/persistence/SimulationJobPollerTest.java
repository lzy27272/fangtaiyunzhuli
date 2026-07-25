package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunResult;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

class SimulationJobPollerTest {
    @Test
    void carriesScenarioAndApiRunIdentityWhileSeparatingCutoffFromExecutionClock() {
        var pipelineClock = Clock.fixed(
                BuiltInSimulationFixture.FIXED_NOW, ZoneOffset.UTC);
        var jobTime = Instant.parse("2026-07-23T04:00:00Z");
        var jobClock = Clock.fixed(jobTime, ZoneOffset.UTC);
        var simulationRunId =
                UUID.fromString("30000000-0000-0000-0000-000000000004");
        var job = new ClaimedSimulationJob(
                UUID.fromString("40000000-0000-0000-0000-000000000001"),
                UUID.fromString("40000000-0000-0000-0000-000000000002"),
                UUID.fromString("40000000-0000-0000-0000-000000000003"),
                simulationRunId,
                BuiltInSimulationFixture.DEFAULT_SCOPE,
                UUID.fromString("40000000-0000-0000-0000-000000000004"),
                "SIMULATION_PIPELINE",
                "SIMULATION_PIPELINE",
                "MANUAL_SIMULATION",
                BuiltInSimulationFixture.CUTOFF_AT,
                jobTime.plus(Duration.ofMinutes(10)),
                1,
                3,
                BuiltInSimulationFixture.FIXED_NOW,
                SimulationScenarioCode.LATE_BRIEF_REPLAY,
                BuiltInSimulationFixture.defaultConfiguration(),
                BuiltInSimulationFixture.HOTEL_NAME);
        var repository = new RecordingRepository(job);
        var pipeline = new DeterministicSimulationPipeline(
                new SourceConnectorRegistry(List.<SourceConnector>of(
                        new SimulationPmsConnector(pipelineClock),
                        new SimulationCtripConnector(pipelineClock),
                        new SimulationMeituanConnector(pipelineClock))),
                pipelineClock);

        new SimulationJobPoller(
                repository,
                pipeline,
                UUID.fromString("50000000-0000-0000-0000-000000000001"),
                jobClock).pollOnce();

        assertEquals(simulationRunId, repository.result.runId());
        assertEquals(
                SimulationScenarioCode.LATE_BRIEF_REPLAY,
                repository.result.scenarioCode());
        assertEquals(
                BuiltInSimulationFixture.CUTOFF_AT,
                repository.result.cutoffAt());
        assertEquals(
                jobTime,
                repository.completedAt);
        assertEquals(jobTime, repository.claimedAt);
        assertNotEquals(job.fixedClockAt(), job.scheduledFor());
    }

    private static final class RecordingRepository
            implements SimulationJobRepository {
        private final ClaimedSimulationJob job;
        private boolean claimed;
        private SimulationRunResult result;
        private Instant completedAt;
        private Instant claimedAt;

        private RecordingRepository(ClaimedSimulationJob job) {
            this.job = job;
        }

        @Override
        public Optional<ClaimedSimulationJob> claimNext(
                UUID workerServicePrincipalId,
                Instant now,
                Duration leaseDuration) {
            if (claimed) {
                return Optional.empty();
            }
            claimed = true;
            claimedAt = now;
            return Optional.of(job);
        }

        @Override
        public void persistSuccessfulRun(
                ClaimedSimulationJob claimedJob,
                SimulationRunResult successfulResult,
                UUID workerServicePrincipalId,
                Instant successfulAt) {
            assertEquals(job, claimedJob);
            result = successfulResult;
            completedAt = successfulAt;
        }

        @Override
        public void completeFailure(
                ClaimedSimulationJob claimedJob,
                UUID workerServicePrincipalId,
                Instant failedAt,
                String failureCode,
                boolean retryable) {
            throw new AssertionError("unexpected failure: " + failureCode);
        }
    }
}
