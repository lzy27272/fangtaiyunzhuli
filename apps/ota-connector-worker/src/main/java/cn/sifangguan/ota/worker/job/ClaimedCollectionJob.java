package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record ClaimedCollectionJob(
        UUID jobId,
        UUID leaseId,
        String connectorCode,
        UUID connectorVersionId,
        CollectionRequest request,
        String databaseTriggerType,
        Instant scheduledFor,
        int attemptCount,
        int maxAttempts,
        Instant leaseExpiresAt) {
    public ClaimedCollectionJob {
        Objects.requireNonNull(jobId, "jobId");
        Objects.requireNonNull(leaseId, "leaseId");
        Objects.requireNonNull(connectorCode, "connectorCode");
        if (connectorCode.isBlank()) {
            throw new IllegalArgumentException("connectorCode must not be blank");
        }
        Objects.requireNonNull(connectorVersionId, "connectorVersionId");
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(databaseTriggerType, "databaseTriggerType");
        if (databaseTriggerType.isBlank()) {
            throw new IllegalArgumentException(
                    "databaseTriggerType must not be blank");
        }
        Objects.requireNonNull(scheduledFor, "scheduledFor");
        if (attemptCount < 1 || maxAttempts < 1 || attemptCount > maxAttempts) {
            throw new IllegalArgumentException(
                    "attemptCount must be within [1,maxAttempts]");
        }
        Objects.requireNonNull(leaseExpiresAt, "leaseExpiresAt");
    }

    /**
     * Compatibility constructor retained for isolated executor contract tests.
     * Database-backed jobs use the canonical constructor with persisted
     * connector-version and retry metadata.
     */
    public ClaimedCollectionJob(
            UUID jobId,
            UUID leaseId,
            String connectorCode,
            CollectionRequest request,
            Instant leaseExpiresAt) {
        this(
                jobId,
                leaseId,
                connectorCode,
                UUID.nameUUIDFromBytes(
                        ("test-version|" + connectorCode)
                                .getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                request,
                "NORMAL",
                request.cutoffAt(),
                1,
                1,
                leaseExpiresAt);
    }

    public boolean willRetry(boolean retryable) {
        return retryable && attemptCount < maxAttempts;
    }
}
