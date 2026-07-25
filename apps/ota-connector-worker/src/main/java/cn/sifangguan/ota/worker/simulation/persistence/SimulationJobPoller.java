package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunCommand;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

public final class SimulationJobPoller {
    private static final Duration LEASE_DURATION = Duration.ofMinutes(10);

    private final SimulationJobRepository repository;
    private final DeterministicSimulationPipeline pipeline;
    private final UUID workerServicePrincipalId;
    private final Clock clock;
    private final AtomicBoolean polling = new AtomicBoolean();

    public SimulationJobPoller(
            SimulationJobRepository repository,
            DeterministicSimulationPipeline pipeline,
            UUID workerServicePrincipalId,
            Clock clock) {
        this.repository = Objects.requireNonNull(repository, "repository");
        this.pipeline = Objects.requireNonNull(pipeline, "pipeline");
        this.workerServicePrincipalId = Objects.requireNonNull(
                workerServicePrincipalId, "workerServicePrincipalId");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    @Scheduled(
            fixedDelayString = "${ota.sprint1.simulation.poll-delay:5s}",
            initialDelayString = "${ota.sprint1.simulation.poll-delay:5s}")
    public void pollOnce() {
        if (!polling.compareAndSet(false, true)) {
            return;
        }
        try {
            var now = Instant.now(clock);
            repository.claimNext(workerServicePrincipalId, now, LEASE_DURATION)
                    .ifPresent(this::execute);
        } finally {
            polling.set(false);
        }
    }

    private void execute(ClaimedSimulationJob job) {
        if (!job.isSupportedSimulationPipeline()) {
            repository.completeFailure(
                    job,
                    workerServicePrincipalId,
                    Instant.now(clock),
                    "UNSUPPORTED_SIMULATION_JOB",
                    false);
            return;
        }
        if (!job.fixedClockAt().equals(BuiltInSimulationFixture.FIXED_NOW)
                || !job.scheduledFor().equals(BuiltInSimulationFixture.CUTOFF_AT)) {
            repository.completeFailure(
                    job,
                    workerServicePrincipalId,
                    Instant.now(clock),
                    "SIMULATION_CLOCK_MISMATCH",
                    false);
            return;
        }
        try {
            var result = pipeline.run(new SimulationRunCommand(
                    job.scope(),
                    job.hotelName(),
                    job.scenarioCode(),
                    job.simulationRunId(),
                    job.configuration()));
            repository.persistSuccessfulRun(
                    job, result, workerServicePrincipalId, Instant.now(clock));
        } catch (RuntimeException ignored) {
            // Never surface connector/database messages: they may contain restricted identifiers.
            repository.completeFailure(
                    job,
                    workerServicePrincipalId,
                    Instant.now(clock),
                    "SIMULATION_PIPELINE_FAILED",
                    true);
        }
    }
}
