package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionResult;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

public record JobExecutionOutcome(
        JobExecutionStatus status,
        Optional<CollectionResult> result,
        String sanitizedFailureCode,
        Instant finishedAt) {

    public JobExecutionOutcome {
        Objects.requireNonNull(status, "status");
        result = Objects.requireNonNull(result, "result");
        sanitizedFailureCode = Objects.requireNonNullElse(sanitizedFailureCode, "");
        Objects.requireNonNull(finishedAt, "finishedAt");
        if (status == JobExecutionStatus.RESULT_RECEIVED && result.isEmpty()) {
            throw new IllegalArgumentException("RESULT_RECEIVED requires a connector result");
        }
        if (status != JobExecutionStatus.RESULT_RECEIVED && result.isPresent()) {
            throw new IllegalArgumentException("transport failure must not include a connector result");
        }
        if (status == JobExecutionStatus.RESULT_RECEIVED && !sanitizedFailureCode.isEmpty()) {
            throw new IllegalArgumentException("RESULT_RECEIVED must not contain a transport failure code");
        }
        if (status != JobExecutionStatus.RESULT_RECEIVED && sanitizedFailureCode.isBlank()) {
            throw new IllegalArgumentException("transport failure requires a sanitized failure code");
        }
    }

    public static JobExecutionOutcome result(CollectionResult result, Instant finishedAt) {
        return new JobExecutionOutcome(
                JobExecutionStatus.RESULT_RECEIVED,
                Optional.of(result),
                "",
                finishedAt);
    }

    public static JobExecutionOutcome failure(
            JobExecutionStatus status,
            String sanitizedFailureCode,
            Instant finishedAt) {
        return new JobExecutionOutcome(status, Optional.empty(), sanitizedFailureCode, finishedAt);
    }
}
