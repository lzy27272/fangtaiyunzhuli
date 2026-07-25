package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunResult;

import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface SimulationJobRepository {
    Optional<ClaimedSimulationJob> claimNext(
            UUID workerServicePrincipalId,
            Instant now,
            Duration leaseDuration);

    void persistSuccessfulRun(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            UUID workerServicePrincipalId,
            Instant completedAt);

    void completeFailure(
            ClaimedSimulationJob job,
            UUID workerServicePrincipalId,
            Instant completedAt,
            String failureCode,
            boolean retryable);
}
