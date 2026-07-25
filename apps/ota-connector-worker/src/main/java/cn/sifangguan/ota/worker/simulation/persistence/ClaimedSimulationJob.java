package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationHotelConfiguration;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record ClaimedSimulationJob(
        UUID jobId,
        UUID leaseId,
        UUID collectionRunId,
        UUID simulationRunId,
        TenantHotelRef scope,
        UUID schedulingConnectorId,
        String jobType,
        String streamCode,
        String triggerType,
        Instant scheduledFor,
        Instant leaseExpiresAt,
        int attemptCount,
        int maxAttempts,
        Instant fixedClockAt,
        SimulationScenarioCode scenarioCode,
        SimulationHotelConfiguration configuration,
        String hotelName) {

    public ClaimedSimulationJob {
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(leaseId, "leaseId");
        Objects.requireNonNull(collectionRunId, "collectionRunId");
        Objects.requireNonNull(simulationRunId, "simulationRunId");
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(schedulingConnectorId, "schedulingConnectorId");
        jobType = requireText(jobType, "jobType");
        streamCode = requireText(streamCode, "streamCode");
        triggerType = requireText(triggerType, "triggerType");
        Objects.requireNonNull(scheduledFor, "scheduledFor");
        Objects.requireNonNull(leaseExpiresAt, "leaseExpiresAt");
        if (attemptCount < 1 || maxAttempts < 1 || attemptCount > maxAttempts) {
            throw new IllegalArgumentException(
                    "attemptCount must be within [1,maxAttempts]");
        }
        Objects.requireNonNull(fixedClockAt, "fixedClockAt");
        Objects.requireNonNull(scenarioCode, "scenarioCode");
        Objects.requireNonNull(configuration, "configuration");
        hotelName = requireText(hotelName, "hotelName");
    }

    public boolean isSupportedSimulationPipeline() {
        return jobType.equals("SIMULATION_PIPELINE")
                && streamCode.equals("SIMULATION_PIPELINE")
                && triggerType.equals("MANUAL_SIMULATION");
    }

    public boolean willRetry(boolean retryableFailure) {
        return retryableFailure && attemptCount < maxAttempts;
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
