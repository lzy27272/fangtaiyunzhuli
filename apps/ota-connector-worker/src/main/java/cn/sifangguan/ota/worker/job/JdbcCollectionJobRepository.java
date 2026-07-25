package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.CollectionWindow;
import cn.sifangguan.ota.contracts.collection.PmsBusinessDayContext;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import cn.sifangguan.ota.contracts.record.RoomNightStay;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;

/**
 * PostgreSQL claim/result adapter for ordinary COLLECTION jobs.
 *
 * <p>A result is committed atomically as collection control evidence plus the
 * immutable raw-evidence and normalized standard records carried by its
 * envelopes. Only a complete successful result may advance the checkpoint.</p>
 */
public final class JdbcCollectionJobRepository
        implements CollectionJobClaimPort, CollectionJobLeasePort {
    private static final Duration CLAIM_LEASE = Duration.ofMinutes(10);
    private static final Duration RECORD_LEASE = Duration.ofMinutes(5);
    private static final Pattern PARSER_VERSION =
            Pattern.compile("^[A-Za-z0-9._+-]{1,64}$");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper;
    private final CollectionResultSafetyGate resultSafetyGate;

    public JdbcCollectionJobRepository(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper objectMapper,
            CollectionResultSafetyGate resultSafetyGate) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.transactions = Objects.requireNonNull(transactions, "transactions");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
        this.resultSafetyGate = Objects.requireNonNull(
                resultSafetyGate,
                "resultSafetyGate");
    }

    @Override
    public Optional<ClaimedCollectionJob> claimNext(
            WorkerIdentity worker,
            Instant now) {
        Objects.requireNonNull(worker, "worker");
        Objects.requireNonNull(now, "now");
        var workerId = workerServicePrincipalId(worker);
        var rows = jdbc.query("""
                SELECT job_id, lease_id, tenant_id, hotel_id, connector_id,
                       simulation_run_id, job_type, stream_code, trigger_type,
                       run_id, scheduled_for, lease_expires_at,
                       attempt_count, max_attempts
                  FROM control.claim_ota_job(?, ?, ?, ?, ?, ?)
                """,
                (row, ignored) -> new RawClaim(
                        row.getObject("job_id", UUID.class),
                        row.getObject("lease_id", UUID.class),
                        row.getObject("tenant_id", UUID.class),
                        row.getObject("hotel_id", UUID.class),
                        row.getObject("connector_id", UUID.class),
                        row.getObject("simulation_run_id", UUID.class),
                        row.getString("job_type"),
                        row.getString("stream_code"),
                        row.getString("trigger_type"),
                        row.getObject("run_id", UUID.class),
                        row.getObject("scheduled_for", OffsetDateTime.class)
                                .toInstant(),
                        row.getObject("lease_expires_at", OffsetDateTime.class)
                                .toInstant(),
                        row.getInt("attempt_count"),
                        row.getInt("max_attempts")),
                workerId,
                UUID.randomUUID(),
                UUID.randomUUID(),
                utc(now),
                utc(now.plus(CLAIM_LEASE)),
                "COLLECTION");
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        if (rows.size() != 1) {
            throw new IllegalStateException(
                    "COLLECTION_CLAIM_RETURNED_MULTIPLE_JOBS");
        }
        var claim = rows.getFirst();
        if (!"COLLECTION".equals(claim.jobType())
                || claim.simulationRunId() != null) {
            throw new IllegalStateException(
                    "NON_COLLECTION_JOB_RETURNED_BY_COLLECTION_CLAIM");
        }
        return Optional.of(tenantTransaction(
                claim.tenantId(),
                () -> hydrate(claim)));
    }

    @Override
    public boolean renew(
            ClaimedCollectionJob job,
            WorkerIdentity worker,
            Instant now,
            Instant newExpiry) {
        Objects.requireNonNull(job, "job");
        Objects.requireNonNull(now, "now");
        Objects.requireNonNull(newExpiry, "newExpiry");
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "SELECT control.renew_ota_job_lease(?, ?, ?, ?, ?)",
                Boolean.class,
                job.jobId(),
                job.leaseId(),
                workerServicePrincipalId(worker),
                utc(now),
                utc(newExpiry)));
    }

    @Override
    public void record(
            ClaimedCollectionJob job,
            WorkerIdentity worker,
            JobExecutionOutcome outcome,
            Instant recordedAt) {
        Objects.requireNonNull(job, "job");
        Objects.requireNonNull(worker, "worker");
        Objects.requireNonNull(outcome, "outcome");
        Objects.requireNonNull(recordedAt, "recordedAt");
        outcome.result().ifPresent(result -> resultSafetyGate.validate(
                job.connectorCode(),
                job.request(),
                result,
                recordedAt));
        var workerId = workerServicePrincipalId(worker);

        tenantTransaction(job.request().scope().tenantId(), () -> {
            if (!renew(
                    job,
                    worker,
                    recordedAt,
                    recordedAt.plus(RECORD_LEASE))) {
                throw new IllegalStateException("COLLECTION_JOB_LEASE_LOST");
            }
            var persistedRunId = persistRun(job, outcome);
            persistRecords(job, outcome, persistedRunId);
            persistAttempt(job, outcome, persistedRunId);
            persistCheckpoint(job, outcome, persistedRunId, recordedAt);
            var completion = completion(job, outcome);
            var completed = jdbc.queryForObject(
                    "SELECT control.complete_ota_job(?, ?, ?, ?, ?, ?)",
                    Boolean.class,
                    job.jobId(),
                    job.leaseId(),
                    workerId,
                    utc(recordedAt),
                    completion.outcomeCode(),
                    completion.failureCode());
            if (!Boolean.TRUE.equals(completed)) {
                throw new IllegalStateException(
                        "COLLECTION_JOB_COMPLETION_REJECTED");
            }
            return null;
        });
    }

    private ClaimedCollectionJob hydrate(RawClaim claim) {
        var rows = jdbc.query("""
                SELECT connector.adapter_code,
                       connector.source_type,
                       version.connector_version_id,
                       version.version_no,
                       schedule.timeout_seconds,
                       schedule.lookback_minutes,
                       checkpoint.committed_watermark::text AS committed_watermark,
                       business.pms_business_date,
                       business.observed_at AS business_observed_at
                  FROM ota.hotel_source_connector connector
                  JOIN ota.hotel_source_connector_version version
                    ON version.tenant_id = connector.tenant_id
                   AND version.hotel_id = connector.hotel_id
                   AND version.connector_id = connector.connector_id
                   AND version.status = 'ACTIVE'
                  JOIN ota.connector_collection_schedule schedule
                    ON schedule.tenant_id = connector.tenant_id
                   AND schedule.hotel_id = connector.hotel_id
                   AND schedule.connector_id = connector.connector_id
                   AND schedule.stream_code = ?
                   AND schedule.trigger_type = ?
                   AND schedule.enabled
             LEFT JOIN ota.connector_stream_checkpoint checkpoint
                    ON checkpoint.tenant_id = connector.tenant_id
                   AND checkpoint.hotel_id = connector.hotel_id
                   AND checkpoint.connector_id = connector.connector_id
                   AND checkpoint.stream_code = ?
             LEFT JOIN LATERAL (
                       SELECT observation.pms_business_date,
                              observation.observed_at
                         FROM ota.pms_business_day_observation observation
                        WHERE observation.tenant_id = connector.tenant_id
                          AND observation.hotel_id = connector.hotel_id
                        ORDER BY observation.observed_at DESC
                        LIMIT 1
                       ) business ON TRUE
                 WHERE connector.tenant_id = ?
                   AND connector.hotel_id = ?
                   AND connector.connector_id = ?
                   AND connector.lifecycle_status IN (
                       'READY_FOR_TEST', 'SHADOW', 'UAT'
                   )
                   AND connector.connector_mode IN ('SIMULATION', 'FILE_IMPORT')
                """,
                (row, ignored) -> new HydratedConnector(
                        row.getString("adapter_code"),
                        SourceSystem.valueOf(row.getString("source_type")),
                        row.getObject("connector_version_id", UUID.class),
                        row.getLong("version_no"),
                        row.getInt("timeout_seconds"),
                        row.getInt("lookback_minutes"),
                        row.getString("committed_watermark"),
                        row.getObject(
                                "pms_business_date",
                                java.time.LocalDate.class),
                        optionalInstant(row.getObject(
                                "business_observed_at",
                                OffsetDateTime.class))),
                claim.streamCode(),
                claim.triggerType(),
                claim.streamCode(),
                claim.tenantId(),
                claim.hotelId(),
                claim.connectorId());
        if (rows.size() != 1) {
            throw new IllegalStateException(
                    "COLLECTION_CONNECTOR_CONFIGURATION_NOT_EXECUTABLE");
        }
        var connector = rows.getFirst();
        var stream = stream(
                claim.streamCode(),
                connector.sourceSystem());
        var cutoff = claim.scheduledFor();
        var request = new CollectionRequest(
                new TenantHotelRef(claim.tenantId(), claim.hotelId()),
                claim.connectorId(),
                connector.versionNo(),
                claim.runId(),
                stream,
                trigger(claim.triggerType()),
                new CollectionWindow(
                        cutoff.minus(Duration.ofMinutes(
                                connector.lookbackMinutes())),
                        cutoff),
                watermark(connector.committedWatermark()),
                businessDayContext(connector),
                cutoff,
                Duration.ofSeconds(connector.timeoutSeconds()),
                new TraceContext(
                        "collection-" + claim.runId(),
                        "job-" + claim.jobId()));
        return new ClaimedCollectionJob(
                claim.jobId(),
                claim.leaseId(),
                connector.adapterCode(),
                connector.connectorVersionId(),
                request,
                claim.triggerType(),
                claim.scheduledFor(),
                claim.attemptCount(),
                claim.maxAttempts(),
                claim.leaseExpiresAt());
    }

    private UUID persistRun(
            ClaimedCollectionJob job,
            JobExecutionOutcome outcome) {
        var result = outcome.result().orElse(null);
        var status = result == null
                ? CollectionStatus.FAILED.name() : result.status().name();
        var completeness = result == null
                ? CompletenessState.UNAVAILABLE.name()
                : result.quality().completeness().name();
        var sourceValidAt = result == null
                ? null
                : result.sourceEffectiveAt().map(JdbcCollectionJobRepository::utc)
                        .orElse(null);
        var observedAt = result == null
                ? utc(outcome.finishedAt()) : utc(result.observedAt());
        var candidateWatermark = result == null
                ? null : watermarkJson(result.candidateWatermark());
        var recordCount = result == null ? 0 : result.records().size();
        var errorCode = result == null
                ? safeFailureCode(outcome.sanitizedFailureCode())
                : result.error().map(error -> safeFailureCode(error.code()))
                        .orElse(null);
        var runIds = jdbc.query("""
                INSERT INTO ota.connector_collection_run(
                    tenant_id, hotel_id, run_id, connector_id,
                    connector_version_id, simulation_run_id, stream_code,
                    trigger_type, scheduled_for, window_from_exclusive,
                    window_to_inclusive, cutoff_at, reconciliation_epoch,
                    status, completeness_code, source_valid_at, observed_at,
                    candidate_watermark, record_count, page_count,
                    error_code, started_at, finished_at
                ) VALUES (
                    ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL,
                    ?, ?, ?, ?, CAST(? AS jsonb), ?, 1, ?, ?, ?
                )
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, stream_code,
                    trigger_type, scheduled_for
                ) WHERE simulation_run_id IS NULL
                DO UPDATE SET
                    status = EXCLUDED.status,
                    completeness_code = EXCLUDED.completeness_code,
                    source_valid_at = EXCLUDED.source_valid_at,
                    observed_at = EXCLUDED.observed_at,
                    candidate_watermark = EXCLUDED.candidate_watermark,
                    record_count = EXCLUDED.record_count,
                    page_count = EXCLUDED.page_count,
                    error_code = EXCLUDED.error_code,
                    finished_at = EXCLUDED.finished_at,
                    row_version = ota.connector_collection_run.row_version + 1,
                    updated_at = EXCLUDED.finished_at
                RETURNING run_id
                """,
                (row, ignored) -> row.getObject("run_id", UUID.class),
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                job.request().runId(),
                job.request().connectorId(),
                job.connectorVersionId(),
                job.request().stream().name(),
                job.databaseTriggerType(),
                utc(job.scheduledFor()),
                utc(job.request().window().fromExclusive()),
                utc(job.request().window().toInclusive()),
                utc(job.request().cutoffAt()),
                status,
                completeness,
                sourceValidAt,
                observedAt,
                candidateWatermark,
                recordCount,
                errorCode,
                utc(outcome.finishedAt()),
                utc(outcome.finishedAt()));
        if (runIds.size() != 1) {
            throw new IllegalStateException(
                    "COLLECTION_RUN_PERSISTENCE_REJECTED");
        }
        return runIds.getFirst();
    }

    private void persistRecords(
            ClaimedCollectionJob job,
            JobExecutionOutcome outcome,
            UUID runId) {
        var result = outcome.result().orElse(null);
        if (result == null || result.records().isEmpty()) {
            return;
        }
        var parserVersion = parserVersion(job);
        for (var envelope : result.records()) {
            persistRawAndStandardRecord(
                    job,
                    runId,
                    parserVersion,
                    envelope);
        }
    }

    private String parserVersion(ClaimedCollectionJob job) {
        var parserVersion = jdbc.queryForObject("""
                SELECT parser_version
                  FROM ota.hotel_source_connector_version
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND connector_id = ?
                   AND connector_version_id = ?
                """,
                String.class,
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                job.request().connectorId(),
                job.connectorVersionId());
        if (parserVersion == null
                || !PARSER_VERSION.matcher(parserVersion).matches()) {
            throw new IllegalStateException(
                    "COLLECTION_PARSER_VERSION_INVALID");
        }
        return parserVersion;
    }

    private void persistRawAndStandardRecord(
            ClaimedCollectionJob job,
            UUID runId,
            String parserVersion,
            StandardRecordEnvelope<?> envelope) {
        var sourceKeyHash = sha256(envelope.record().sourceRecordKey());
        var normalizedPayload = normalizedPayload(envelope);
        var contentHash = sha256(normalizedPayload);
        var rawRecordId = deterministicId(
                "raw",
                job,
                envelope.record().recordType(),
                sourceKeyHash,
                contentHash);
        var standardRecordId = deterministicId(
                "standard",
                job,
                envelope.record().recordType(),
                sourceKeyHash,
                contentHash);
        var evidence = envelope.evidence();
        var sourceValidAt = envelope.sourceEffectiveAt()
                .map(JdbcCollectionJobRepository::utc)
                .orElse(null);

        jdbc.update("""
                INSERT INTO ota.source_raw_record(
                    tenant_id, hotel_id, raw_record_id, run_id, connector_id,
                    connector_version_id, stream_code, source_record_key_hash,
                    source_valid_at, observed_at, evidence_ref, evidence_sha256,
                    parser_version, normalized_content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, stream_code,
                    source_record_key_hash, normalized_content_hash
                ) DO NOTHING
                """,
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                rawRecordId,
                runId,
                job.request().connectorId(),
                job.connectorVersionId(),
                job.request().stream().name(),
                sourceKeyHash,
                sourceValidAt,
                utc(envelope.observedAt()),
                evidence.referenceId(),
                evidence.sha256(),
                parserVersion,
                contentHash);

        jdbc.update("""
                INSERT INTO ota.source_standard_record(
                    tenant_id, hotel_id, standard_record_id, run_id,
                    raw_record_id, connector_id, connector_version_id,
                    record_type, source_event_key_hash, source_valid_at,
                    observed_at, parser_version, content_hash,
                    normalized_payload
                ) VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb)
                )
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, record_type,
                    source_event_key_hash, content_hash
                ) DO NOTHING
                """,
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                standardRecordId,
                runId,
                rawRecordId,
                job.request().connectorId(),
                job.connectorVersionId(),
                envelope.record().recordType(),
                sourceKeyHash,
                sourceValidAt,
                utc(envelope.observedAt()),
                parserVersion,
                contentHash,
                normalizedPayload);
    }

    private String normalizedPayload(
            StandardRecordEnvelope<?> envelope) {
        StandardRecord record = envelope.record();
        var payload = new LinkedHashMap<String, Object>();
        payload.put("schemaVersion", envelope.schemaVersion());
        payload.put("recordType", record.recordType());
        if (record instanceof PmsBusinessDateRecord value) {
            payload.put("observationKey", value.observationKey());
            payload.put("businessDate", value.businessDate());
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else if (record instanceof PmsOperatingRecord value) {
            payload.put("observationKey", value.observationKey());
            payload.put("businessDate", value.businessDate());
            payload.put("asOf", value.asOf());
            payload.put("totalRoomRevenue", value.totalRoomRevenue());
            payload.put("hourlyRoomRevenue", value.hourlyRoomRevenue());
            payload.put("overnightSold", value.overnightSold());
            payload.put("currentAvailable", value.currentAvailable());
            payload.put(
                    "effectiveSellableTotal",
                    value.effectiveSellableTotal().orElse(null));
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else if (record instanceof InventoryAvailabilityRecord value) {
            payload.put("sourceInventoryId", value.sourceInventoryId());
            payload.put("displayName", value.displayName());
            payload.put("itemKind", value.itemKind());
            payload.put(
                    "effectiveAvailable",
                    value.effectiveAvailable().orElse(null));
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else if (record instanceof BookingRevisionRecord value) {
            payload.put(
                    "externalBookingIdHash",
                    sha256(value.externalBookingId()));
            payload.put("revisionKeyHash", sha256(value.revisionKey()));
            payload.put("eventAt", value.eventAt());
            payload.put("eventBusinessDate", value.eventBusinessDate());
            payload.put(
                    "beforeRoomNights",
                    normalizedRoomNights(value.beforeRoomNights()));
            payload.put(
                    "afterRoomNights",
                    normalizedRoomNights(value.afterRoomNights()));
            payload.put(
                    "wholeOrderCancellation",
                    value.wholeOrderCancellation());
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else {
            payload.put(
                    "sourceRecordKeyHash",
                    sha256(record.sourceRecordKey()));
            payload.put("sourceUpdatedAt", record.sourceUpdatedAt());
        }
        return json(payload);
    }

    private static List<Map<String, Object>> normalizedRoomNights(
            Map<RoomNightStay, Integer> values) {
        return values.entrySet().stream()
                .map(entry -> {
                    var row = new LinkedHashMap<String, Object>();
                    row.put(
                            "inventoryPoolId",
                            entry.getKey().inventoryPoolId());
                    row.put("stayDate", entry.getKey().stayDate());
                    row.put("quantity", entry.getValue());
                    return Map.copyOf(row);
                })
                .toList();
    }

    private static UUID deterministicId(
            String kind,
            ClaimedCollectionJob job,
            String recordType,
            String sourceKeyHash,
            String contentHash) {
        var identity = String.join(
                "|",
                "ota-collection-v1",
                kind,
                job.request().scope().tenantId().toString(),
                job.request().scope().hotelId().toString(),
                job.request().connectorId().toString(),
                job.request().stream().name(),
                recordType,
                sourceKeyHash,
                contentHash);
        return UUID.nameUUIDFromBytes(
                identity.getBytes(StandardCharsets.UTF_8));
    }

    private void persistAttempt(
            ClaimedCollectionJob job,
            JobExecutionOutcome outcome,
            UUID runId) {
        var result = outcome.result().orElse(null);
        var status = result == null
                ? CollectionStatus.FAILED.name() : result.status().name();
        var failureCode = result == null
                ? safeFailureCode(outcome.sanitizedFailureCode())
                : result.error().map(error -> safeFailureCode(error.code()))
                        .orElse(null);
        var category = result == null
                ? outcome.status().name() : "CONNECTOR_RESULT";
        var fingerprint = sha256(
                status + "|" + category + "|"
                        + (result == null ? 0 : result.records().size())
                        + "|" + Objects.requireNonNullElse(failureCode, ""));
        var attemptId = UUID.nameUUIDFromBytes(
                (runId + "|" + job.attemptCount())
                        .getBytes(StandardCharsets.UTF_8));
        jdbc.update("""
                INSERT INTO ota.connector_collection_attempt(
                    tenant_id, hotel_id, run_id, attempt_id, attempt_no,
                    fragment_code, page_no, status, result_category,
                    sanitized_error_code, response_fingerprint,
                    started_at, finished_at
                ) VALUES (
                    ?, ?, ?, ?, ?, 'FULL', 1, ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT (tenant_id, hotel_id, run_id, attempt_id)
                DO NOTHING
                """,
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                runId,
                attemptId,
                job.attemptCount(),
                status,
                category,
                failureCode,
                fingerprint,
                utc(outcome.finishedAt()),
                utc(outcome.finishedAt()));
    }

    private void persistCheckpoint(
            ClaimedCollectionJob job,
            JobExecutionOutcome outcome,
            UUID runId,
            Instant recordedAt) {
        var result = outcome.result().orElse(null);
        var completeSuccess = result != null
                && result.status() == CollectionStatus.SUCCESS
                && result.quality().completeness()
                        == CompletenessState.COMPLETE
                && result.quality().dataQuality() == DataQualityState.FRESH
                && result.quality().paginationValidation() != ValidationState.FAIL
                && result.quality().fieldValidation() != ValidationState.FAIL
                && result.quality().capabilityValidation() != ValidationState.FAIL
                && result.error().isEmpty()
                && result.candidateWatermark().isPresent()
                && candidateDoesNotRegress(
                        job.request().committedWatermark(),
                        result.candidateWatermark().orElseThrow());
        if (completeSuccess) {
            jdbc.update("""
                    INSERT INTO ota.connector_stream_checkpoint(
                        tenant_id, hotel_id, connector_id, stream_code,
                        committed_watermark, committed_run_id, committed_at,
                        last_success_at, last_observed_at, freshness_state,
                        consecutive_failure_count, stale_after,
                        last_reason_code, updated_at
                    ) VALUES (
                        ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?,
                        'FRESH', 0, ?, NULL, ?
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, connector_id, stream_code
                    ) DO UPDATE SET
                        committed_watermark = EXCLUDED.committed_watermark,
                        committed_run_id = EXCLUDED.committed_run_id,
                        committed_at = EXCLUDED.committed_at,
                        last_success_at = EXCLUDED.last_success_at,
                        last_observed_at = EXCLUDED.last_observed_at,
                        freshness_state = 'FRESH',
                        consecutive_failure_count = 0,
                        stale_after = EXCLUDED.stale_after,
                        last_reason_code = NULL,
                        row_version =
                            ota.connector_stream_checkpoint.row_version + 1,
                        updated_at = EXCLUDED.updated_at
                    """,
                    job.request().scope().tenantId(),
                    job.request().scope().hotelId(),
                    job.request().connectorId(),
                    job.request().stream().name(),
                    watermarkJson(result.candidateWatermark()),
                    runId,
                    utc(recordedAt),
                    utc(recordedAt),
                    utc(result.observedAt()),
                    utc(result.observedAt().plus(Duration.ofMinutes(32))),
                    utc(recordedAt));
            return;
        }

        var partial = result != null
                && result.status() == CollectionStatus.PARTIAL;
        var freshness = partial ? "SUSPECT" : "UNAVAILABLE";
        var reason = result == null
                ? safeFailureCode(outcome.sanitizedFailureCode())
                : result.error().map(error -> safeFailureCode(error.code()))
                        .orElse(partial
                                ? "COLLECTION_PARTIAL"
                                : "COLLECTION_UNAVAILABLE");
        var observedAt = result == null
                ? outcome.finishedAt() : result.observedAt();
        jdbc.update("""
                INSERT INTO ota.connector_stream_checkpoint(
                    tenant_id, hotel_id, connector_id, stream_code,
                    last_observed_at, freshness_state,
                    consecutive_failure_count, last_reason_code, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, stream_code
                ) DO UPDATE SET
                    last_observed_at = EXCLUDED.last_observed_at,
                    freshness_state = EXCLUDED.freshness_state,
                    consecutive_failure_count =
                        ota.connector_stream_checkpoint
                            .consecutive_failure_count + 1,
                    last_reason_code = EXCLUDED.last_reason_code,
                    row_version =
                        ota.connector_stream_checkpoint.row_version + 1,
                    updated_at = EXCLUDED.updated_at
                """,
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                job.request().connectorId(),
                job.request().stream().name(),
                utc(observedAt),
                freshness,
                reason,
                utc(recordedAt));
    }

    private static boolean candidateDoesNotRegress(
            Optional<CollectionWatermark> committedValue,
            CollectionWatermark candidate) {
        if (committedValue.isEmpty()) {
            return true;
        }
        var committed = committedValue.orElseThrow();
        return candidate.type().equals(committed.type())
                && !candidate.sourceUpdatedAt().isBefore(committed.sourceUpdatedAt())
                && (!candidate.sourceUpdatedAt().equals(committed.sourceUpdatedAt())
                || candidate.opaqueValue().equals(committed.opaqueValue()));
    }

    private Completion completion(
            ClaimedCollectionJob job,
            JobExecutionOutcome outcome) {
        if (outcome.result().isEmpty()) {
            var retryable = outcome.status()
                    == JobExecutionStatus.EXECUTION_FAILED
                    || outcome.status()
                    == JobExecutionStatus.EXECUTION_TIMEOUT;
            return failedCompletion(
                    job,
                    retryable,
                    safeFailureCode(outcome.sanitizedFailureCode()));
        }
        CollectionResult result = outcome.result().orElseThrow();
        if (result.status() == CollectionStatus.SUCCESS
                || result.status() == CollectionStatus.PARTIAL) {
            return new Completion("SUCCEEDED", null);
        }
        var error = result.error().orElse(null);
        var failureCode = error == null
                ? result.status().name()
                : safeFailureCode(error.code());
        return failedCompletion(
                job,
                error != null && error.retryable(),
                failureCode);
    }

    private static Completion failedCompletion(
            ClaimedCollectionJob job,
            boolean retryable,
            String failureCode) {
        return new Completion(
                job.willRetry(retryable)
                        ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE",
                safeFailureCode(failureCode));
    }

    private Optional<CollectionWatermark> watermark(String json) {
        if (json == null || json.isBlank()) {
            return Optional.empty();
        }
        try {
            var root = objectMapper.readTree(json);
            return Optional.of(new CollectionWatermark(
                    root.path("type").asText(),
                    root.path("opaqueValue").asText(),
                    Instant.parse(root.path("sourceUpdatedAt").asText())));
        } catch (RuntimeException | JsonProcessingException exception) {
            throw new IllegalStateException(
                    "COLLECTION_CHECKPOINT_INVALID", exception);
        }
    }

    private String watermarkJson(Optional<CollectionWatermark> value) {
        return value.map(watermark -> json(Map.of(
                "type", watermark.type(),
                "opaqueValue", watermark.opaqueValue(),
                "sourceUpdatedAt", watermark.sourceUpdatedAt().toString())))
                .orElse(null);
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "COLLECTION_WATERMARK_SERIALIZATION_FAILED", exception);
        }
    }

    private static Optional<PmsBusinessDayContext> businessDayContext(
            HydratedConnector connector) {
        if (connector.businessDate() == null
                || connector.businessObservedAt().isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new PmsBusinessDayContext(
                connector.businessDate(),
                connector.businessObservedAt().orElseThrow()));
    }

    private static DataStreamType stream(
            String value,
            SourceSystem source) {
        return switch (value) {
            case "BUSINESS_DAY" -> DataStreamType.BUSINESS_DATE;
            case "ROOM_REVENUE" -> DataStreamType.ROOM_REVENUE_AGGREGATE;
            case "ORDER_ROOM_NIGHT" -> DataStreamType.BOOKING_EVENT;
            case "INVENTORY" -> source == SourceSystem.PMS
                    ? DataStreamType.INVENTORY_ROOM_TYPE
                    : DataStreamType.INVENTORY_SELL_PRODUCT;
            default -> DataStreamType.valueOf(value);
        };
    }

    private static CollectionTrigger trigger(String value) {
        return switch (value) {
            case "NORMAL" -> CollectionTrigger.SCHEDULED;
            case "HOURLY_CUTOFF" -> CollectionTrigger.HOURLY_COORDINATION;
            case "FILE_IMPORT" -> CollectionTrigger.OFFICIAL_IMPORT;
            default -> throw new IllegalStateException(
                    "COLLECTION_TRIGGER_UNSUPPORTED");
        };
    }

    private static UUID workerServicePrincipalId(WorkerIdentity worker) {
        Objects.requireNonNull(worker, "worker");
        try {
            return UUID.fromString(worker.nodeId());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "WORKER_SERVICE_PRINCIPAL_ID_INVALID", exception);
        }
    }

    private <T> T tenantTransaction(
            UUID tenantId,
            Supplier<T> operation) {
        return transactions.execute(status -> {
            var configured = jdbc.queryForObject(
                    "SELECT set_config('app.tenant_id', ?, true)",
                    String.class,
                    tenantId.toString());
            if (!tenantId.toString().equals(configured)) {
                throw new IllegalStateException(
                        "COLLECTION_TENANT_CONTEXT_NOT_SET");
            }
            return operation.get();
        });
    }

    private static Optional<Instant> optionalInstant(
            OffsetDateTime value) {
        return value == null
                ? Optional.empty() : Optional.of(value.toInstant());
    }

    private static OffsetDateTime utc(Instant value) {
        return value.atOffset(ZoneOffset.UTC);
    }

    private static String safeFailureCode(String value) {
        var normalized = Objects.requireNonNullElse(
                        value, "COLLECTION_FAILED")
                .toUpperCase(java.util.Locale.ROOT)
                .replaceAll("[^A-Z0-9_]", "_");
        if (normalized.isBlank()) {
            return "COLLECTION_FAILED";
        }
        return normalized.substring(0, Math.min(96, normalized.length()));
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private record RawClaim(
            UUID jobId,
            UUID leaseId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID simulationRunId,
            String jobType,
            String streamCode,
            String triggerType,
            UUID runId,
            Instant scheduledFor,
            Instant leaseExpiresAt,
            int attemptCount,
            int maxAttempts) {
    }

    private record HydratedConnector(
            String adapterCode,
            SourceSystem sourceSystem,
            UUID connectorVersionId,
            long versionNo,
            int timeoutSeconds,
            int lookbackMinutes,
            String committedWatermark,
            java.time.LocalDate businessDate,
            Optional<Instant> businessObservedAt) {
    }

    private record Completion(
            String outcomeCode,
            String failureCode) {
    }
}
