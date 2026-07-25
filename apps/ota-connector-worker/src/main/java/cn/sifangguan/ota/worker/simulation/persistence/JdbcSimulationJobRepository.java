package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import cn.sifangguan.ota.worker.simulation.domain.MetricState;
import cn.sifangguan.ota.worker.simulation.domain.MetricValue;
import cn.sifangguan.ota.worker.simulation.domain.InventoryPoolDefinition;
import cn.sifangguan.ota.worker.simulation.domain.ProductInventoryMapping;
import cn.sifangguan.ota.worker.simulation.domain.RevenuePaceConfig;
import cn.sifangguan.ota.worker.simulation.domain.SimulationOutboxPreview;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunResult;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationHotelConfiguration;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.IncorrectResultSizeDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * PostgreSQL adapter for the explicitly enabled Sprint 1 simulation. Every
 * hotel-scoped write, checkpoint advance and job completion is committed in one
 * tenant transaction. No method performs HTTP or external message delivery.
 */
public final class JdbcSimulationJobRepository implements SimulationJobRepository {
    private static final String PARSER_VERSION = "sprint1-fixture-v1";
    private static final String COMPUTATION_VERSION = "sprint1-deterministic-v1";

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;
    private final ObjectMapper objectMapper;

    public JdbcSimulationJobRepository(
            JdbcTemplate jdbc,
            TransactionTemplate transactions,
            ObjectMapper objectMapper) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.transactions = Objects.requireNonNull(transactions, "transactions");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper");
    }

    @Override
    public Optional<ClaimedSimulationJob> claimNext(
            UUID workerServicePrincipalId,
            Instant now,
            Duration leaseDuration) {
        Objects.requireNonNull(workerServicePrincipalId, "workerServicePrincipalId");
        Objects.requireNonNull(now, "now");
        Objects.requireNonNull(leaseDuration, "leaseDuration");
        if (leaseDuration.isZero()
                || leaseDuration.isNegative()
                || leaseDuration.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException("leaseDuration must be within (0,15m]");
        }
        var leaseId = UUID.randomUUID();
        var runId = UUID.randomUUID();
        var raw = jdbc.query("""
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
                        row.getObject("scheduled_for", OffsetDateTime.class).toInstant(),
                        row.getObject("lease_expires_at", OffsetDateTime.class).toInstant(),
                        row.getInt("attempt_count"),
                        row.getInt("max_attempts")),
                workerServicePrincipalId,
                leaseId,
                runId,
                utc(now),
                utc(now.plus(leaseDuration)),
                "SIMULATION_PIPELINE");
        if (raw.isEmpty()) {
            return Optional.empty();
        }
        if (raw.size() != 1) {
            throw new IllegalStateException("CLAIM_FUNCTION_RETURNED_MULTIPLE_JOBS");
        }
        var claim = raw.getFirst();
        return Optional.of(tenantTransaction(claim.tenantId(), () -> hydrateClaim(claim, now)));
    }

    @Override
    public void persistSuccessfulRun(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            UUID workerServicePrincipalId,
            Instant completedAt) {
        Objects.requireNonNull(job, "job");
        Objects.requireNonNull(result, "result");
        Objects.requireNonNull(workerServicePrincipalId, "workerServicePrincipalId");
        Objects.requireNonNull(completedAt, "completedAt");
        if (!job.scope().tenantId().equals(
                result.collections().values().stream()
                        .flatMap(List::stream)
                        .flatMap(value -> value.records().stream())
                        .findFirst()
                        .map(StandardRecordEnvelope::tenantId)
                        .orElseThrow())) {
            throw new IllegalArgumentException("result tenant does not match claimed job");
        }
        if (!result.runId().equals(job.simulationRunId())) {
            throw new IllegalArgumentException(
                    "result runId does not match claimed simulationRunId");
        }

        tenantTransaction(job.scope().tenantId(), () -> {
            assertLeaseStillValid(job, workerServicePrincipalId, completedAt);
            var connectors = loadConnectorContexts(job.scope());
            var poolIds = loadAndValidateInventoryConfiguration(
                    job.scope(),
                    connectors,
                    job.configuration());
            var runIds = persistCollectionEvidence(job, result, connectors, completedAt);
            var businessDayIds = persistBusinessDayAndOperatingFacts(
                    job, result, connectors, runIds);
            persistInventoryFacts(
                    job, result, connectors, runIds, businessDayIds.businessDayRunId(), poolIds);
            persistBookingFacts(job, result, connectors, runIds, poolIds);
            var published = persistSnapshotAndBrief(
                    job, result, businessDayIds.businessDayRunId(), completedAt);
            persistIncidentsTasksAndBlockedOutbox(
                    job, result, published, workerServicePrincipalId, completedAt);
            advanceCheckpoints(job, result, runIds, completedAt);

            var updated = jdbc.update("""
                    UPDATE ota.simulation_run
                       SET status = 'SUCCEEDED',
                           completed_at = ?,
                           failure_code = NULL,
                           row_version = row_version + 1,
                           updated_at = ?
                     WHERE tenant_id = ?
                       AND hotel_id = ?
                       AND simulation_run_id = ?
                       AND status IN ('REQUESTED', 'RUNNING')
                       AND delivery_mode = 'SIMULATION_ONLY'
                       AND NOT external_delivery_allowed
                    """,
                    utc(completedAt),
                    utc(completedAt),
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    job.simulationRunId());
            if (updated != 1) {
                throw new IllegalStateException("SIMULATION_RUN_SUCCESS_TRANSITION_REJECTED");
            }
            completeJob(
                    job, workerServicePrincipalId, completedAt, "SUCCEEDED", null);
            return null;
        });
    }

    @Override
    public void completeFailure(
            ClaimedSimulationJob job,
            UUID workerServicePrincipalId,
            Instant completedAt,
            String failureCode,
            boolean retryable) {
        Objects.requireNonNull(job, "job");
        Objects.requireNonNull(workerServicePrincipalId, "workerServicePrincipalId");
        Objects.requireNonNull(completedAt, "completedAt");
        requireFailureCode(failureCode);
        tenantTransaction(job.scope().tenantId(), () -> {
            var willRetry = job.willRetry(retryable);
            if (willRetry) {
                jdbc.update("""
                        UPDATE ota.simulation_run
                           SET status = 'RUNNING',
                               failure_code = ?,
                               row_version = row_version + 1,
                               updated_at = ?
                         WHERE tenant_id = ?
                           AND hotel_id = ?
                           AND simulation_run_id = ?
                           AND status IN ('REQUESTED', 'RUNNING')
                        """,
                        failureCode,
                        utc(completedAt),
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        job.simulationRunId());
            } else {
                jdbc.update("""
                        UPDATE ota.simulation_run
                           SET status = 'FAILED',
                               failure_code = ?,
                               completed_at = ?,
                               row_version = row_version + 1,
                               updated_at = ?
                         WHERE tenant_id = ?
                           AND hotel_id = ?
                           AND simulation_run_id = ?
                           AND status IN ('REQUESTED', 'RUNNING')
                        """,
                        failureCode,
                        utc(completedAt),
                        utc(completedAt),
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        job.simulationRunId());
            }
            completeJob(
                    job,
                    workerServicePrincipalId,
                    completedAt,
                    willRetry ? "RETRYABLE_FAILURE" : "TERMINAL_FAILURE",
                    failureCode);
            return null;
        });
    }

    private ClaimedSimulationJob hydrateClaim(RawClaim claim, Instant now) {
        var rows = jdbc.query("""
                SELECT simulation.fixed_clock_at,
                       simulation.scenario_code,
                       simulation.status,
                       hotel.timezone,
                       hotel.display_name
                  FROM ota.simulation_run simulation
                  JOIN ota.hotel hotel
                    ON hotel.tenant_id = simulation.tenant_id
                   AND hotel.hotel_id = simulation.hotel_id
                 WHERE simulation.tenant_id = ?
                   AND simulation.hotel_id = ?
                   AND simulation.simulation_run_id = ?
                   AND simulation.delivery_mode = 'SIMULATION_ONLY'
                   AND NOT simulation.external_delivery_allowed
                   AND simulation.status IN ('REQUESTED', 'RUNNING')
                """,
                (row, ignored) -> new HydratedRun(
                        row.getObject("fixed_clock_at", OffsetDateTime.class).toInstant(),
                        row.getString("scenario_code"),
                        row.getString("timezone"),
                        row.getString("display_name")),
                claim.tenantId(),
                claim.hotelId(),
                claim.simulationRunId());
        if (rows.size() != 1) {
            throw new IllegalStateException("SIMULATION_RUN_NOT_CLAIMABLE");
        }
        var run = rows.getFirst();
        var scope = new TenantHotelRef(claim.tenantId(), claim.hotelId());
        var configuration = loadSimulationHotelConfiguration(
                scope,
                ZoneId.of(run.timezone()));
        jdbc.update("""
                UPDATE ota.simulation_run
                   SET status = 'RUNNING',
                       started_at = COALESCE(started_at, ?),
                       failure_code = NULL,
                       row_version = row_version + 1,
                       updated_at = ?
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND simulation_run_id = ?
                   AND status IN ('REQUESTED', 'RUNNING')
                """,
                utc(now),
                utc(now),
                claim.tenantId(),
                claim.hotelId(),
                claim.simulationRunId());
        return new ClaimedSimulationJob(
                claim.jobId(),
                claim.leaseId(),
                claim.runId(),
                claim.simulationRunId(),
                scope,
                claim.connectorId(),
                claim.jobType(),
                claim.streamCode(),
                claim.triggerType(),
                claim.scheduledFor(),
                claim.leaseExpiresAt(),
                claim.attemptCount(),
                claim.maxAttempts(),
                run.fixedClockAt(),
                SimulationScenarioCode.parse(run.scenarioCode()),
                configuration,
                run.hotelName());
    }

    private Map<SourceSystem, DatabaseConnectorContext> loadConnectorContexts(
            TenantHotelRef scope) {
        var rows = jdbc.query("""
                SELECT connector.source_type,
                       connector.connector_id,
                       version.connector_version_id,
                       version.parser_version
                  FROM ota.hotel_source_connector connector
                  JOIN ota.hotel_source_connector_version version
                    ON version.tenant_id = connector.tenant_id
                   AND version.hotel_id = connector.hotel_id
                   AND version.connector_id = connector.connector_id
                   AND version.status = 'ACTIVE'
                 WHERE connector.tenant_id = ?
                   AND connector.hotel_id = ?
                   AND connector.connector_mode = 'SIMULATION'
                   AND connector.lifecycle_status IN ('READY_FOR_TEST', 'SHADOW', 'UAT')
                   AND connector.source_type IN ('PMS', 'CTRIP', 'MEITUAN')
                """,
                (row, ignored) -> new DatabaseConnectorContext(
                        SourceSystem.valueOf(row.getString("source_type")),
                        row.getObject("connector_id", UUID.class),
                        row.getObject("connector_version_id", UUID.class),
                        row.getString("parser_version")),
                scope.tenantId(),
                scope.hotelId());
        var contexts = new EnumMap<SourceSystem, DatabaseConnectorContext>(SourceSystem.class);
        for (var row : rows) {
            if (contexts.putIfAbsent(row.source(), row) != null) {
                throw new IllegalStateException("DUPLICATE_ACTIVE_SIMULATION_CONNECTOR");
            }
        }
        if (!contexts.keySet().containsAll(
                List.of(SourceSystem.PMS, SourceSystem.CTRIP, SourceSystem.MEITUAN))) {
            throw new IllegalStateException("SIMULATION_CONNECTOR_CONFIGURATION_INCOMPLETE");
        }
        return Map.copyOf(contexts);
    }

    private SimulationHotelConfiguration loadSimulationHotelConfiguration(
            TenantHotelRef scope,
            ZoneId hotelZone) {
        var pmsFixtureIds = fixtureInventoryIdsByHash(
                SourceSystem.PMS,
                DataStreamType.INVENTORY_ROOM_TYPE);
        var otaFixtureIds = new EnumMap<SourceSystem, Map<String, String>>(
                SourceSystem.class);
        otaFixtureIds.put(
                SourceSystem.CTRIP,
                fixtureInventoryIdsByHash(
                        SourceSystem.CTRIP,
                        DataStreamType.INVENTORY_SELL_PRODUCT));
        otaFixtureIds.put(
                SourceSystem.MEITUAN,
                fixtureInventoryIdsByHash(
                        SourceSystem.MEITUAN,
                        DataStreamType.INVENTORY_SELL_PRODUCT));

        var configuredPools = jdbc.query("""
                SELECT pool.pool_code,
                       pool.display_name,
                       product.source_product_key_hash
                  FROM ota.hotel_inventory_pool pool
                  JOIN ota.source_product_mapping_version mapping
                    ON mapping.tenant_id = pool.tenant_id
                   AND mapping.hotel_id = pool.hotel_id
                   AND mapping.inventory_pool_id = pool.inventory_pool_id
                   AND mapping.status = 'ACTIVE'
                  JOIN ota.source_sellable_product product
                    ON product.tenant_id = mapping.tenant_id
                   AND product.hotel_id = mapping.hotel_id
                   AND product.connector_id = mapping.connector_id
                   AND product.source_product_id = mapping.source_product_id
                   AND product.status = 'ACTIVE'
                  JOIN ota.hotel_source_connector connector
                    ON connector.tenant_id = product.tenant_id
                   AND connector.hotel_id = product.hotel_id
                   AND connector.connector_id = product.connector_id
                   AND connector.source_type = 'PMS'
                   AND connector.connector_mode = 'SIMULATION'
                 WHERE pool.tenant_id = ?
                   AND pool.hotel_id = ?
                   AND pool.status = 'ACTIVE'
                 ORDER BY pool.pool_code
                """,
                (row, ignored) -> new ConfiguredPoolRow(
                        row.getString("pool_code"),
                        row.getString("display_name"),
                        row.getString("source_product_key_hash")),
                scope.tenantId(),
                scope.hotelId());
        var pools = new ArrayList<InventoryPoolDefinition>();
        for (var configured : configuredPools) {
            var fixtureId = pmsFixtureIds.get(configured.sourceProductKeyHash());
            if (fixtureId == null) {
                throw new IllegalStateException(
                        "SIMULATION_PMS_FIXTURE_PRODUCT_NOT_CONFIGURED");
            }
            pools.add(new InventoryPoolDefinition(
                    configured.poolCode(),
                    fixtureId,
                    configured.displayName()));
        }

        var configuredMappings = jdbc.query("""
                SELECT connector.source_type,
                       product.source_product_key_hash,
                       pool.pool_code,
                       mapping.version_no
                  FROM ota.source_product_mapping_version mapping
                  JOIN ota.source_sellable_product product
                    ON product.tenant_id = mapping.tenant_id
                   AND product.hotel_id = mapping.hotel_id
                   AND product.connector_id = mapping.connector_id
                   AND product.source_product_id = mapping.source_product_id
                   AND product.status = 'ACTIVE'
                  JOIN ota.hotel_source_connector connector
                    ON connector.tenant_id = product.tenant_id
                   AND connector.hotel_id = product.hotel_id
                   AND connector.connector_id = product.connector_id
                   AND connector.connector_mode = 'SIMULATION'
                   AND connector.source_type IN ('CTRIP', 'MEITUAN')
                  JOIN ota.hotel_inventory_pool pool
                    ON pool.tenant_id = mapping.tenant_id
                   AND pool.hotel_id = mapping.hotel_id
                   AND pool.inventory_pool_id = mapping.inventory_pool_id
                   AND pool.status = 'ACTIVE'
                 WHERE mapping.tenant_id = ?
                   AND mapping.hotel_id = ?
                   AND mapping.status = 'ACTIVE'
                 ORDER BY connector.source_type, product.source_product_key_hash
                """,
                (row, ignored) -> new ConfiguredProductMappingRow(
                        SourceSystem.valueOf(row.getString("source_type")),
                        row.getString("source_product_key_hash"),
                        row.getString("pool_code"),
                        row.getLong("version_no")),
                scope.tenantId(),
                scope.hotelId());
        var mappings = new ArrayList<ProductInventoryMapping>();
        for (var configured : configuredMappings) {
            var fixtureId = otaFixtureIds.get(configured.source())
                    .get(configured.sourceProductKeyHash());
            if (fixtureId == null) {
                throw new IllegalStateException(
                        "SIMULATION_OTA_FIXTURE_PRODUCT_NOT_CONFIGURED");
            }
            mappings.add(new ProductInventoryMapping(
                    configured.source(),
                    fixtureId,
                    configured.poolCode(),
                    configured.version()));
        }

        var targets = jdbc.query("""
                SELECT version_no, target_room_revenue, target_adr
                  FROM ota.hotel_revenue_target_version
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND status = 'ACTIVE'
                   AND valid_business_date_from <= ?
                   AND (
                       valid_business_date_until IS NULL
                       OR valid_business_date_until >= ?
                   )
                 ORDER BY version_no DESC
                """,
                (row, ignored) -> new ConfiguredTargetRow(
                        row.getLong("version_no"),
                        row.getBigDecimal("target_room_revenue"),
                        row.getBigDecimal("target_adr")),
                scope.tenantId(),
                scope.hotelId(),
                BuiltInSimulationFixture.BUSINESS_DATE,
                BuiltInSimulationFixture.BUSINESS_DATE);
        var localCutoff = BuiltInSimulationFixture.CUTOFF_AT
                .atZone(hotelZone)
                .toLocalTime();
        var pacePoints = jdbc.query("""
                SELECT curve.version_no,
                       point.expected_revenue_progress_pct,
                       point.expected_sell_progress_pct
                  FROM ota.hotel_pace_curve_version curve
                  JOIN ota.hotel_pace_curve_point point
                    ON point.tenant_id = curve.tenant_id
                   AND point.hotel_id = curve.hotel_id
                   AND point.pace_curve_version_id = curve.pace_curve_version_id
                 WHERE curve.tenant_id = ?
                   AND curve.hotel_id = ?
                   AND curve.status = 'ACTIVE'
                   AND curve.effective_from <= ?
                   AND (
                       curve.effective_until IS NULL
                       OR curve.effective_until >= ?
                   )
                   AND point.local_cutoff_time = ?
                 ORDER BY curve.version_no DESC
                """,
                (row, ignored) -> new ConfiguredPaceRow(
                        row.getLong("version_no"),
                        row.getBigDecimal("expected_revenue_progress_pct"),
                        row.getBigDecimal("expected_sell_progress_pct")),
                scope.tenantId(),
                scope.hotelId(),
                BuiltInSimulationFixture.BUSINESS_DATE,
                BuiltInSimulationFixture.BUSINESS_DATE,
                localCutoff);
        if (pools.isEmpty()
                || mappings.isEmpty()
                || targets.size() != 1
                || pacePoints.size() != 1) {
            throw new IllegalStateException(
                    "SIMULATION_HOTEL_CONFIGURATION_INCOMPLETE");
        }
        var target = targets.getFirst();
        var pace = pacePoints.getFirst();
        var configurationVersion = Math.addExact(
                Math.multiplyExact(target.version(), 1_000_000L),
                pace.version());
        return new SimulationHotelConfiguration(
                hotelZone,
                pools,
                mappings,
                new RevenuePaceConfig(
                        configurationVersion,
                        target.roomRevenue(),
                        target.targetAdr(),
                        pace.revenueProgressPercent().movePointLeft(2),
                        pace.sellProgressPercent().movePointLeft(2)));
    }

    private Map<String, String> fixtureInventoryIdsByHash(
            SourceSystem source,
            DataStreamType stream) {
        var byHash = new HashMap<String, String>();
        for (var value : BuiltInSimulationFixture.records(source, stream)) {
            var record = (InventoryAvailabilityRecord) value;
            var previous = byHash.put(
                    sha256(record.sourceInventoryId()),
                    record.sourceInventoryId());
            if (previous != null) {
                throw new IllegalStateException(
                        "DUPLICATE_SIMULATION_FIXTURE_PRODUCT_HASH");
            }
        }
        return Map.copyOf(byHash);
    }

    private Map<String, UUID> loadAndValidateInventoryConfiguration(
            TenantHotelRef scope,
            Map<SourceSystem, DatabaseConnectorContext> connectors,
            SimulationHotelConfiguration configuration) {
        var poolIds = new LinkedHashMap<String, UUID>();
        jdbc.query("""
                SELECT pool_code, inventory_pool_id
                  FROM ota.hotel_inventory_pool
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND status = 'ACTIVE'
                """,
                row -> {
                    poolIds.put(
                            row.getString("pool_code"),
                            row.getObject("inventory_pool_id", UUID.class));
                },
                scope.tenantId(),
                scope.hotelId());
        for (var pool : configuration.inventoryPools()) {
            if (!poolIds.containsKey(pool.inventoryPoolId())) {
                throw new IllegalStateException(
                        "SIMULATION_INVENTORY_POOL_CONFIG_MISSING");
            }
        }

        var expectedMappings = new ArrayList<ExpectedMapping>();
        for (var pool : configuration.inventoryPools()) {
            expectedMappings.add(new ExpectedMapping(
                    SourceSystem.PMS,
                    pool.pmsPhysicalRoomTypeId(),
                    pool.inventoryPoolId()));
        }
        configuration.productMappings().forEach(mapping ->
                expectedMappings.add(new ExpectedMapping(
                        mapping.channel(),
                        mapping.otaProductId(),
                        mapping.inventoryPoolId())));
        for (var expected : expectedMappings) {
            var connector = connectors.get(expected.source());
            var count = jdbc.queryForObject("""
                    SELECT count(*)
                      FROM ota.source_sellable_product product
                      JOIN ota.source_product_mapping_version mapping
                        ON mapping.tenant_id = product.tenant_id
                       AND mapping.hotel_id = product.hotel_id
                       AND mapping.connector_id = product.connector_id
                       AND mapping.source_product_id = product.source_product_id
                       AND mapping.status = 'ACTIVE'
                      JOIN ota.hotel_inventory_pool pool
                        ON pool.tenant_id = mapping.tenant_id
                       AND pool.hotel_id = mapping.hotel_id
                       AND pool.inventory_pool_id = mapping.inventory_pool_id
                       AND pool.status = 'ACTIVE'
                     WHERE product.tenant_id = ?
                       AND product.hotel_id = ?
                       AND product.connector_id = ?
                       AND product.source_product_key_hash = ?
                       AND pool.pool_code = ?
                    """,
                    Integer.class,
                    scope.tenantId(),
                    scope.hotelId(),
                    connector.connectorId(),
                    sha256(expected.sourceKey()),
                    expected.poolCode());
            if (!Integer.valueOf(1).equals(count)) {
                throw new IllegalStateException(
                        "SIMULATION_PRODUCT_MAPPING_CONFIG_MISSING");
            }
        }
        return Map.copyOf(poolIds);
    }

    private Map<CollectionResult, PersistedCollectionRun> persistCollectionEvidence(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            Map<SourceSystem, DatabaseConnectorContext> connectors,
            Instant completedAt) {
        var persisted = new IdentityHashMap<CollectionResult, PersistedCollectionRun>();
        for (var sourceEntry : result.collections().entrySet()) {
            var source = sourceEntry.getKey();
            var connector = connectors.get(source);
            for (var collection : sourceEntry.getValue()) {
                var firstEnvelope = collection.records().stream().findFirst()
                        .orElseThrow(() -> new IllegalStateException(
                                "SIMULATION_COLLECTION_MUST_NOT_BE_EMPTY"));
                var stream = firstEnvelope.stream();
                var runId = firstEnvelope.runId();
                var fromExclusive = collectionWindowFrom(stream, result.cutoffAt());
                var candidateJson = collection.candidateWatermark()
                        .map(value -> json(Map.of(
                                "type", value.type(),
                                "opaqueValue", value.opaqueValue(),
                                "sourceUpdatedAt", value.sourceUpdatedAt().toString())))
                        .orElse(null);
                jdbc.update("""
                        INSERT INTO ota.connector_collection_run(
                            tenant_id, hotel_id, run_id, connector_id,
                            connector_version_id, simulation_run_id, stream_code,
                            trigger_type, scheduled_for, window_from_exclusive,
                            window_to_inclusive, cutoff_at, reconciliation_epoch,
                            status, completeness_code, source_valid_at, observed_at,
                            candidate_watermark, record_count, page_count,
                            started_at, finished_at
                        ) VALUES (
                            ?, ?, ?, ?, ?, ?, ?, 'MANUAL_SIMULATION', ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, CAST(? AS jsonb), ?, 1, ?, ?
                        )
                        ON CONFLICT (
                            tenant_id, hotel_id, connector_id,
                            stream_code, trigger_type, scheduled_for,
                            simulation_run_id
                        ) WHERE simulation_run_id IS NOT NULL
                        DO NOTHING
                        """,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        runId,
                        connector.connectorId(),
                        connector.connectorVersionId(),
                        job.simulationRunId(),
                        stream.name(),
                        utc(result.cutoffAt()),
                        utc(fromExclusive),
                        utc(result.cutoffAt()),
                        utc(result.cutoffAt()),
                        result.runId(),
                        collection.status().name(),
                        collection.quality().completeness().name(),
                        collection.sourceEffectiveAt().map(JdbcSimulationJobRepository::utc)
                                .orElse(null),
                        utc(collection.observedAt()),
                        candidateJson,
                        collection.records().size(),
                        utc(result.cutoffAt()),
                        utc(collection.observedAt()));
                var dbRun = new PersistedCollectionRun(
                        runId, source, stream, connector);
                persisted.put(collection, dbRun);
                for (var envelope : collection.records()) {
                    persistRawAndStandardRecord(job, dbRun, envelope);
                }
            }
        }
        return persisted;
    }

    private void persistRawAndStandardRecord(
            ClaimedSimulationJob job,
            PersistedCollectionRun run,
            StandardRecordEnvelope<?> envelope) {
        var rawRecordId = deterministicId("raw|" + envelope.recordId());
        var sourceKeyHash = sha256(envelope.record().sourceRecordKey());
        var normalizedPayload = normalizedPayload(envelope.record());
        var contentHash = sha256(normalizedPayload);
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
                job.scope().tenantId(),
                job.scope().hotelId(),
                rawRecordId,
                run.runId(),
                run.connector().connectorId(),
                run.connector().connectorVersionId(),
                run.stream().name(),
                sourceKeyHash,
                envelope.sourceEffectiveAt().map(JdbcSimulationJobRepository::utc).orElse(null),
                utc(envelope.observedAt()),
                envelope.evidence().referenceId(),
                envelope.evidence().sha256(),
                run.connector().parserVersion(),
                contentHash);
        jdbc.update("""
                INSERT INTO ota.source_standard_record(
                    tenant_id, hotel_id, standard_record_id, run_id, raw_record_id,
                    connector_id, connector_version_id, record_type,
                    source_event_key_hash, source_valid_at, observed_at,
                    parser_version, content_hash, normalized_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS jsonb))
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, record_type,
                    source_event_key_hash, content_hash
                ) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                deterministicId("standard|" + envelope.recordId()),
                run.runId(),
                rawRecordId,
                run.connector().connectorId(),
                run.connector().connectorVersionId(),
                envelope.record().recordType(),
                sourceKeyHash,
                envelope.sourceEffectiveAt().map(JdbcSimulationJobRepository::utc).orElse(null),
                utc(envelope.observedAt()),
                run.connector().parserVersion(),
                contentHash,
                normalizedPayload);
    }

    private BusinessDayIds persistBusinessDayAndOperatingFacts(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            Map<SourceSystem, DatabaseConnectorContext> connectors,
            Map<CollectionResult, PersistedCollectionRun> runIds) {
        var businessCollection = findCollection(
                result, SourceSystem.PMS, DataStreamType.BUSINESS_DATE);
        var businessEnvelope = typedEnvelopes(
                businessCollection, PmsBusinessDateRecord.class).getFirst();
        var businessRecord = businessEnvelope.record();
        var databaseRun = runIds.get(businessCollection);
        var observationId = deterministicId(
                "business-day-observation|" + businessEnvelope.recordId());
        var interval = businessEnvelope.sourceDetectionInterval().orElseThrow();
        var contentHash = sha256(normalizedPayload(businessRecord));
        jdbc.update("""
                INSERT INTO ota.pms_business_day_observation(
                    tenant_id, hotel_id, observation_id, run_id, connector_id,
                    connector_version_id, pms_business_date, source_effective_at,
                    detected_after, detected_at_or_before, observed_at,
                    evidence_ref, content_hash, parser_version
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, run_id, pms_business_date, content_hash
                ) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                observationId,
                databaseRun.runId(),
                databaseRun.connector().connectorId(),
                databaseRun.connector().connectorVersionId(),
                businessRecord.businessDate(),
                utc(interval.fromExclusive()),
                utc(interval.toInclusive()),
                utc(businessEnvelope.observedAt()),
                businessEnvelope.evidence().referenceId(),
                contentHash,
                databaseRun.connector().parserVersion());

        var businessDayRunId = deterministicId(
                "business-day-run|" + job.scope().tenantId() + "|"
                        + job.scope().hotelId() + "|" + businessRecord.businessDate());
        jdbc.update("""
                INSERT INTO ota.business_day_run(
                    tenant_id, hotel_id, business_day_run_id, pms_business_date,
                    opening_observation_id, status, opened_at
                ) VALUES (?, ?, ?, ?, ?, 'OPEN', ?)
                ON CONFLICT (tenant_id, hotel_id, pms_business_date) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                businessDayRunId,
                businessRecord.businessDate(),
                observationId,
                utc(BuiltInSimulationFixture.BUSINESS_DAY_STARTED_AT));
        var persistedBusinessDayRunId = jdbc.queryForObject("""
                SELECT business_day_run_id
                  FROM ota.business_day_run
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND pms_business_date = ?
                """,
                UUID.class,
                job.scope().tenantId(),
                job.scope().hotelId(),
                businessRecord.businessDate());
        if (persistedBusinessDayRunId == null) {
            throw new IllegalStateException("BUSINESS_DAY_RUN_NOT_PERSISTED");
        }

        var operatingCollection = findCollection(
                result, SourceSystem.PMS, DataStreamType.ROOM_REVENUE_AGGREGATE);
        var operatingRun = runIds.get(operatingCollection);
        for (var envelope : typedEnvelopes(
                operatingCollection, PmsOperatingRecord.class)) {
            var record = envelope.record();
            var payload = normalizedPayload(record);
            jdbc.update("""
                    INSERT INTO ota.pms_operating_observation(
                        tenant_id, hotel_id, operating_observation_id, run_id,
                        business_day_run_id, connector_id, connector_version_id,
                        pms_business_date, room_revenue, hourly_room_revenue_included,
                        overnight_sold_room_nights, sellable_room_count,
                        effective_total_room_count, currency_code, source_valid_at,
                        observed_at, evidence_ref, content_hash, parser_version
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, run_id, pms_business_date, content_hash
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    deterministicId("operating|" + envelope.recordId()),
                    operatingRun.runId(),
                    persistedBusinessDayRunId,
                    operatingRun.connector().connectorId(),
                    operatingRun.connector().connectorVersionId(),
                    record.businessDate(),
                    record.totalRoomRevenue(),
                    record.hourlyRoomRevenue(),
                    record.overnightSold(),
                    record.currentAvailable(),
                    record.effectiveSellableTotal()
                            .orElse(record.overnightSold() + record.currentAvailable()),
                    envelope.sourceEffectiveAt().map(JdbcSimulationJobRepository::utc)
                            .orElse(null),
                    utc(envelope.observedAt()),
                    envelope.evidence().referenceId(),
                    sha256(payload),
                    operatingRun.connector().parserVersion());
        }
        return new BusinessDayIds(observationId, persistedBusinessDayRunId);
    }

    private void persistInventoryFacts(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            Map<SourceSystem, DatabaseConnectorContext> connectors,
            Map<CollectionResult, PersistedCollectionRun> runIds,
            UUID businessDayRunId,
            Map<String, UUID> poolIds) {
        for (var source : List.of(
                SourceSystem.PMS, SourceSystem.CTRIP, SourceSystem.MEITUAN)) {
            var collection = findCollection(
                    result,
                    source,
                    source == SourceSystem.PMS
                            ? DataStreamType.INVENTORY_ROOM_TYPE
                            : DataStreamType.INVENTORY_SELL_PRODUCT);
            var run = runIds.get(collection);
            var observationId = deterministicId(
                    "inventory-observation|" + run.runId());
            var evidence = collection.records().getFirst().evidence();
            var observationHash = sha256(collection.records().stream()
                    .map(value -> value.record().sourceRecordKey())
                    .sorted()
                    .reduce("", (left, right) -> left + "|" + right));
            jdbc.update("""
                    INSERT INTO ota.inventory_observation(
                        tenant_id, hotel_id, inventory_observation_id, run_id,
                        connector_id, connector_version_id, business_day_run_id,
                        pms_business_date, reconciliation_epoch, source_valid_at,
                        observed_at, completeness_code, evidence_ref, content_hash,
                        parser_version
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (
                        tenant_id, hotel_id, run_id, reconciliation_epoch, content_hash
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    observationId,
                    run.runId(),
                    run.connector().connectorId(),
                    run.connector().connectorVersionId(),
                    businessDayRunId,
                    result.businessDate(),
                    result.runId(),
                    collection.sourceEffectiveAt().map(JdbcSimulationJobRepository::utc)
                            .orElse(null),
                    utc(collection.observedAt()),
                    collection.quality().completeness().name(),
                    evidence.referenceId(),
                    observationHash,
                    run.connector().parserVersion());
            for (var envelope : typedEnvelopes(
                    collection, InventoryAvailabilityRecord.class)) {
                persistInventoryItem(
                        job,
                        source,
                        run,
                        observationId,
                        envelope,
                        poolIds,
                        collectionSourceAvailable(collection));
            }
        }
    }

    private void persistInventoryItem(
            ClaimedSimulationJob job,
            SourceSystem source,
            PersistedCollectionRun run,
            UUID observationId,
            StandardRecordEnvelope<InventoryAvailabilityRecord> envelope,
            Map<String, UUID> poolIds,
            boolean sourceAvailable) {
        var record = envelope.record();
        var sourceProductId = deterministicId(
                "source-product|" + run.connector().connectorId() + "|"
                        + record.sourceInventoryId());
        var sourceKeyHash = sha256(record.sourceInventoryId());
        jdbc.update("""
                INSERT INTO ota.source_sellable_product(
                    tenant_id, hotel_id, connector_id, source_product_id,
                    product_kind, source_product_key_hash, display_name, status,
                    first_observed_at, last_observed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, connector_id, source_product_key_hash
                ) DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    last_observed_at = GREATEST(
                        ota.source_sellable_product.last_observed_at,
                        EXCLUDED.last_observed_at
                    ),
                    row_version = ota.source_sellable_product.row_version + 1,
                    updated_at = CURRENT_TIMESTAMP
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                run.connector().connectorId(),
                sourceProductId,
                source == SourceSystem.PMS ? "PMS_PHYSICAL_ROOM" : "OTA_SELL_PRODUCT",
                sourceKeyHash,
                record.displayName(),
                utc(envelope.observedAt()),
                utc(envelope.observedAt()));
        var persistedProductId = jdbc.queryForObject("""
                SELECT source_product_id
                  FROM ota.source_sellable_product
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND connector_id = ?
                   AND source_product_key_hash = ?
                """,
                UUID.class,
                job.scope().tenantId(),
                job.scope().hotelId(),
                run.connector().connectorId(),
                sourceKeyHash);
        var mappings = jdbc.query("""
                SELECT mapping.mapping_version_id, mapping.inventory_pool_id
                  FROM ota.source_product_mapping_version mapping
                 WHERE mapping.tenant_id = ?
                   AND mapping.hotel_id = ?
                   AND mapping.connector_id = ?
                   AND mapping.source_product_id = ?
                   AND mapping.status = 'ACTIVE'
                """,
                (row, ignored) -> new PersistedMapping(
                        row.getObject("mapping_version_id", UUID.class),
                        row.getObject("inventory_pool_id", UUID.class)),
                job.scope().tenantId(),
                job.scope().hotelId(),
                run.connector().connectorId(),
                persistedProductId);
        var mapping = mappings.size() == 1 ? mappings.getFirst() : null;
        var quality = inventoryItemQuality(
                record, mapping != null, sourceAvailable);
        var reason = inventoryItemReason(
                record, mapping != null, sourceAvailable);
        jdbc.update("""
                INSERT INTO ota.inventory_observation_item(
                    tenant_id, hotel_id, inventory_observation_id,
                    observation_item_id, connector_id, source_product_id,
                    mapping_version_id, inventory_pool_id, sellable_room_count,
                    sale_switch_open, item_quality_code, reason_code,
                    item_content_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, inventory_observation_id,
                    connector_id, source_product_id
                ) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                observationId,
                deterministicId("inventory-item|" + observationId + "|" + persistedProductId),
                run.connector().connectorId(),
                persistedProductId,
                mapping == null ? null : mapping.mappingVersionId(),
                mapping == null ? null : mapping.inventoryPoolId(),
                nullableSellableRoomCount(record, sourceAvailable),
                quality,
                reason,
                sha256(normalizedPayload(record)));
    }

    private void persistBookingFacts(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            Map<SourceSystem, DatabaseConnectorContext> connectors,
            Map<CollectionResult, PersistedCollectionRun> runIds,
            Map<String, UUID> poolIds) {
        for (var source : List.of(SourceSystem.CTRIP, SourceSystem.MEITUAN)) {
            var collection = findCollection(result, source, DataStreamType.BOOKING_EVENT);
            var run = runIds.get(collection);
            for (var envelope : typedEnvelopes(
                    collection, BookingRevisionRecord.class)) {
                var revision = envelope.record();
                var bookingId = deterministicId(
                        "booking|" + run.connector().connectorId() + "|"
                                + revision.externalBookingId());
                var externalHash = sha256(revision.externalBookingId());
                var cancelled = revision.wholeOrderCancellation();
                jdbc.update("""
                        INSERT INTO ota.source_booking(
                            tenant_id, hotel_id, connector_id, source_booking_id,
                            external_booking_id_hash, current_revision_no,
                            booking_status, first_observed_at, last_observed_at
                        ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
                        ON CONFLICT (
                            tenant_id, hotel_id, connector_id, external_booking_id_hash
                        ) DO UPDATE SET
                            current_revision_no = GREATEST(
                                ota.source_booking.current_revision_no, 1
                            ),
                            booking_status = EXCLUDED.booking_status,
                            last_observed_at = GREATEST(
                                ota.source_booking.last_observed_at,
                                EXCLUDED.last_observed_at
                            ),
                            row_version = ota.source_booking.row_version + 1,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        run.connector().connectorId(),
                        bookingId,
                        externalHash,
                        cancelled ? "CANCELLED" : "ACTIVE",
                        utc(envelope.observedAt()),
                        utc(envelope.observedAt()));
                var persistedBookingId = jdbc.queryForObject("""
                        SELECT source_booking_id
                          FROM ota.source_booking
                         WHERE tenant_id = ?
                           AND hotel_id = ?
                           AND connector_id = ?
                           AND external_booking_id_hash = ?
                        """,
                        UUID.class,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        run.connector().connectorId(),
                        externalHash);
                var revisionId = deterministicId(
                        "booking-revision|" + run.connector().connectorId() + "|"
                                + revision.sourceRecordKey());
                var stays = new ArrayList<>(revision.beforeRoomNights().keySet());
                revision.afterRoomNights().keySet().stream()
                        .filter(stay -> !stays.contains(stay))
                        .forEach(stays::add);
                var arrival = stays.stream()
                        .map(value -> value.stayDate())
                        .min(LocalDate::compareTo)
                        .orElseThrow();
                var departure = stays.stream()
                        .map(value -> value.stayDate())
                        .max(LocalDate::compareTo)
                        .orElseThrow()
                        .plusDays(1);
                var quantity = Math.max(
                        revision.beforeRoomNights().values().stream()
                                .mapToInt(Integer::intValue).max().orElse(0),
                        revision.afterRoomNights().values().stream()
                                .mapToInt(Integer::intValue).max().orElse(0));
                var revisionType = revision.wholeOrderCancellation()
                        ? "CANCELLED"
                        : revision.beforeRoomNights().isEmpty() ? "CREATED" : "MODIFIED";
                var payload = normalizedPayload(revision);
                jdbc.update("""
                        INSERT INTO ota.source_booking_revision(
                            tenant_id, hotel_id, connector_id, source_booking_id,
                            booking_revision_id, revision_no,
                            source_revision_key_hash, revision_type, booking_status,
                            source_event_at, observed_at, arrival_date, departure_date,
                            room_quantity, room_revenue, currency_code, run_id,
                            connector_version_id, parser_version, evidence_ref,
                            content_hash
                        ) VALUES (
                            ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'CNY',
                            ?, ?, ?, ?, ?
                        )
                        ON CONFLICT (
                            tenant_id, hotel_id, connector_id, source_revision_key_hash
                        ) DO NOTHING
                        """,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        run.connector().connectorId(),
                        persistedBookingId,
                        revisionId,
                        bookingRevisionKeyHash(revision),
                        revisionType,
                        cancelled ? "CANCELLED" : "ACTIVE",
                        utc(revision.eventAt()),
                        utc(envelope.observedAt()),
                        arrival,
                        departure,
                        Math.max(quantity, 1),
                        run.runId(),
                        run.connector().connectorVersionId(),
                        run.connector().parserVersion(),
                        envelope.evidence().referenceId(),
                        sha256(payload));
                var persistedRevisionId = jdbc.queryForObject("""
                        SELECT booking_revision_id
                          FROM ota.source_booking_revision
                         WHERE tenant_id = ?
                           AND hotel_id = ?
                           AND connector_id = ?
                           AND source_revision_key_hash = ?
                        """,
                        UUID.class,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        run.connector().connectorId(),
                        bookingRevisionKeyHash(revision));
                if (persistedRevisionId == null) {
                    throw new IllegalStateException(
                            "SOURCE_BOOKING_REVISION_NOT_PERSISTED");
                }
                result.roomNightDeltas().stream()
                        .filter(delta -> delta.channel() == source)
                        .filter(delta -> delta.externalBookingId()
                                .equals(revision.externalBookingId()))
                        .filter(delta -> delta.revisionKey().equals(revision.revisionKey()))
                        .forEach(delta -> {
                            var poolId = poolIds.get(delta.stay().inventoryPoolId());
                            if (poolId == null) {
                                throw new IllegalStateException(
                                        "SIMULATION_DELTA_POOL_CONFIG_MISSING");
                            }
                            var relation = delta.stay().stayDate()
                                    .compareTo(result.businessDate());
                            var relationCode = relation == 0
                                    ? "TODAY" : relation > 0 ? "FUTURE" : "PAST_ANOMALY";
                            var deltaHash = sha256(
                                    delta.externalBookingId() + "|"
                                            + delta.revisionKey() + "|"
                                            + delta.stay() + "|" + delta.reason()
                                            + "|" + delta.quantity());
                            jdbc.update("""
                                    INSERT INTO ota.booking_room_night_delta(
                                        tenant_id, hotel_id, connector_id,
                                        source_booking_id, booking_revision_id,
                                        room_night_delta_id, inventory_pool_id,
                                        stay_date, delta_room_nights, delta_reason,
                                        pms_business_date_at_event,
                                        business_day_relation, occurred_at, content_hash
                                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                                    ON CONFLICT (
                                        tenant_id, hotel_id, connector_id,
                                        source_booking_id, booking_revision_id,
                                        inventory_pool_id, stay_date, delta_reason
                                    ) DO NOTHING
                                    """,
                                    job.scope().tenantId(),
                                    job.scope().hotelId(),
                                    run.connector().connectorId(),
                                    persistedBookingId,
                                    persistedRevisionId,
                                    deterministicId("room-night-delta|" + deltaHash),
                                    poolId,
                                    delta.stay().stayDate(),
                                    delta.quantity(),
                                    delta.reason().name(),
                                    result.businessDate(),
                                    relationCode,
                                    utc(delta.eventAt()),
                                    deltaHash);
                        });
            }
        }
    }

    private PublishedSnapshot persistSnapshotAndBrief(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            UUID businessDayRunId,
            Instant completedAt) {
        var lockedBusinessDay = jdbc.queryForObject("""
                SELECT business_day_run_id
                  FROM ota.business_day_run
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND business_day_run_id = ?
                 FOR UPDATE
                """,
                UUID.class,
                job.scope().tenantId(),
                job.scope().hotelId(),
                businessDayRunId);
        if (!businessDayRunId.equals(lockedBusinessDay)) {
            throw new IllegalStateException("BUSINESS_DAY_RUN_LOCK_FAILED");
        }
        var nextRevisionValue = jdbc.queryForObject("""
                SELECT COALESCE(MAX(revision_no), 0) + 1
                  FROM ota.daily_operation_snapshot
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND business_day_run_id = ?
                   AND snapshot_type = 'HOURLY_CUTOFF'
                   AND cutoff_at = ?
                """,
                Long.class,
                job.scope().tenantId(),
                job.scope().hotelId(),
                businessDayRunId,
                utc(result.cutoffAt()));
        var nextVersion = jdbc.queryForObject("""
                SELECT COALESCE(MAX(version_no), 0) + 1
                  FROM ota.daily_operation_snapshot
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND business_day_run_id = ?
                """,
                Long.class,
                job.scope().tenantId(),
                job.scope().hotelId(),
                businessDayRunId);
        if (nextRevisionValue == null || nextVersion == null) {
            throw new IllegalStateException("SNAPSHOT_VERSION_ALLOCATION_FAILED");
        }
        var nextRevision = Math.toIntExact(nextRevisionValue);
        var snapshotId = deterministicId(
                "snapshot|" + job.scope().tenantId() + "|" + job.scope().hotelId()
                        + "|" + result.businessDate() + "|" + result.cutoffAt()
                        + "|" + job.simulationRunId());
        var sourceObservations = result.freshness().values().stream()
                .flatMap(value -> value.lastObservedAt().stream())
                .sorted()
                .toList();
        var sourceSpan = sourceObservations.isEmpty()
                ? null
                : BigDecimal.valueOf(Duration.between(
                        sourceObservations.getFirst(),
                        sourceObservations.getLast()).toMillis(), 3);
        var snapshotHash = sha256(
                result.businessDate() + "|" + result.cutoffAt() + "|"
                        + result.completeness() + "|" + result.frozenHourlyBrief());
        jdbc.update("""
                INSERT INTO ota.daily_operation_snapshot(
                    tenant_id, hotel_id, snapshot_id, business_day_run_id,
                    pms_business_date, snapshot_type, cutoff_at, revision_no,
                    version_no, reconciliation_epoch, facts_frozen_at,
                    computation_version, completeness_code,
                    source_observation_span_seconds, quality_reason_code,
                    content_hash, simulation_run_id
                ) VALUES (
                    ?, ?, ?, ?, ?, 'HOURLY_CUTOFF', ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?
                )
                ON CONFLICT (
                    tenant_id, hotel_id, business_day_run_id,
                    snapshot_type, cutoff_at, revision_no
                ) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                snapshotId,
                businessDayRunId,
                result.businessDate(),
                utc(result.cutoffAt()),
                nextRevision,
                nextVersion,
                result.runId(),
                utc(completedAt),
                COMPUTATION_VERSION,
                result.completeness().name(),
                sourceSpan,
                result.completeness() == cn.sifangguan.ota.contracts.quality.CompletenessState.COMPLETE
                        ? null : "SOURCE_INCOMPLETE",
                snapshotHash,
                job.simulationRunId());
        persistMetric(job, snapshotId, "TOTAL_REVENUE", result.metrics().totalRevenue(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "OVERNIGHT_REVENUE", result.metrics().overnightRevenue(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "ADR", result.metrics().adr(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "REVPAR", result.metrics().revpar(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "TARGET_PROGRESS", result.metrics().targetProgress(), "RATIO", null);
        persistMetric(job, snapshotId, "TARGET_GAP", result.metrics().targetGap(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "REQUIRED_REMAINING_ADR", result.metrics().requiredRemainingAdr(), "CURRENCY", "CNY");
        persistMetric(job, snapshotId, "SELL_PROGRESS", result.metrics().sellProgress(), "RATIO", null);
        persistMetric(job, snapshotId, "REVENUE_PACE_DEVIATION", result.metrics().revenuePaceDeviation(), "RATIO", null);
        persistMetric(job, snapshotId, "SELL_PACE_DEVIATION", result.metrics().sellPaceDeviation(), "RATIO", null);
        persistMetric(job, snapshotId, "HOURLY_TARGET_SPEED", result.metrics().hourlyTargetSpeed(), "RATIO", null);
        persistMetric(job, snapshotId, "HOURLY_SELL_SPEED", result.metrics().hourlySellSpeed(), "RATIO", null);

        var requestedBriefId = deterministicId(
                "hourly-brief|" + job.scope().tenantId() + "|"
                        + job.scope().hotelId() + "|" + result.businessDate()
                        + "|" + result.cutoffAt());
        var requestedShortCode = "SIM-" + requestedBriefId.toString().replace("-", "")
                .substring(0, 12).toUpperCase(java.util.Locale.ROOT);
        var existingBriefs = jdbc.query("""
                SELECT hourly_brief_id, snapshot_id, message_short_code
                  FROM ota.ota_hourly_brief
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND pms_business_date = ?
                   AND cutoff_at = ?
                """,
                (row, ignored) -> new ExistingBrief(
                        row.getObject("hourly_brief_id", UUID.class),
                        row.getObject("snapshot_id", UUID.class),
                        row.getString("message_short_code")),
                job.scope().tenantId(),
                job.scope().hotelId(),
                result.businessDate(),
                utc(result.cutoffAt()));
        requireExistingBriefForReplay(
                result.scenarioCode(), !existingBriefs.isEmpty());
        UUID briefId;
        String shortCode;
        if (existingBriefs.isEmpty()) {
            jdbc.update("""
                    INSERT INTO ota.ota_hourly_brief(
                        tenant_id, hotel_id, hourly_brief_id, business_day_run_id,
                        snapshot_id, pms_business_date, cutoff_at, frozen_body,
                        content_hash, completeness_code, message_short_code,
                        published_at, simulation_run_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    requestedBriefId,
                    businessDayRunId,
                    snapshotId,
                    result.businessDate(),
                    utc(result.cutoffAt()),
                    result.frozenHourlyBrief(),
                    sha256(result.frozenHourlyBrief()),
                    result.completeness().name(),
                    requestedShortCode,
                    utc(completedAt),
                    job.simulationRunId());
            briefId = requestedBriefId;
            shortCode = requestedShortCode;
        } else {
            if (existingBriefs.size() != 1) {
                throw new IllegalStateException("HOURLY_BRIEF_SLOT_NOT_UNIQUE");
            }
            var original = existingBriefs.getFirst();
            briefId = original.briefId();
            shortCode = original.shortCode();
            var adjustmentType =
                    result.scenarioCode()
                                    == cn.sifangguan.ota.worker.simulation.pipeline
                                            .SimulationScenarioCode.LATE_BRIEF_REPLAY
                            ? "LATE_DATA" : "CORRECTION";
            var reasonCode =
                    result.scenarioCode()
                                    == cn.sifangguan.ota.worker.simulation.pipeline
                                            .SimulationScenarioCode.LATE_BRIEF_REPLAY
                            ? "LATE_BRIEF_REPLAY" : "SIMULATION_SCENARIO_REVISION";
            var summary = "Simulation replacement snapshot "
                    + job.simulationRunId()
                    + "; delivery remains SIMULATION/DELIVERY_BLOCKED.";
            jdbc.update("""
                    INSERT INTO ota.ota_brief_adjustment(
                        tenant_id, hotel_id, adjustment_id, hourly_brief_id,
                        original_snapshot_id, replacement_snapshot_id,
                        original_cutoff_at, adjustment_type, reason_code,
                        adjustment_summary, content_hash, simulation_run_id,
                        replacement_frozen_body, replacement_body_hash
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (
                        tenant_id, hotel_id, hourly_brief_id, replacement_snapshot_id
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    deterministicId(
                            "brief-adjustment|" + briefId + "|" + snapshotId),
                    briefId,
                    original.snapshotId(),
                    snapshotId,
                    utc(result.cutoffAt()),
                    adjustmentType,
                    reasonCode,
                    summary,
                    sha256(summary),
                    job.simulationRunId(),
                    result.frozenHourlyBrief(),
                    sha256(result.frozenHourlyBrief()));
        }
        return new PublishedSnapshot(snapshotId, briefId, shortCode);
    }

    private void persistMetric(
            ClaimedSimulationJob job,
            UUID snapshotId,
            String metricCode,
            MetricValue metric,
            String unit,
            String currency) {
        var quality = metricQualityCode(metric.state());
        var reason = metricReasonCode(metric);
        jdbc.update("""
                INSERT INTO ota.daily_operation_snapshot_metric(
                    tenant_id, hotel_id, snapshot_id, metric_id, metric_code,
                    numeric_value, unit_code, currency_code, quality_code,
                    reason_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (
                    tenant_id, hotel_id, snapshot_id, metric_code
                ) DO NOTHING
                """,
                job.scope().tenantId(),
                job.scope().hotelId(),
                snapshotId,
                deterministicId("metric|" + snapshotId + "|" + metricCode),
                metricCode,
                metric.value().orElse(null),
                unit,
                currency,
                quality,
                reason);
    }

    private void persistIncidentsTasksAndBlockedOutbox(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            PublishedSnapshot published,
            UUID workerServicePrincipalId,
            Instant completedAt) {
        for (int index = 0; index < result.reconciliation().incidents().size(); index++) {
            var incident = result.reconciliation().incidents().get(index);
            var correlationKey = incident.channel() + "|"
                    + incident.otaProductId() + "|"
                    + incident.inventoryPoolId() + "|" + incident.direction();
            jdbc.update("""
                    INSERT INTO ota.ota_incident(
                        tenant_id, hotel_id, incident_id, incident_type,
                        severity, source_code, direction_code, correlation_key,
                        status, opened_at, last_observed_at
                    ) VALUES (
                        ?, ?, ?, 'INVENTORY_MISMATCH', 'P1', ?, ?, ?, 'OPEN', ?, ?
                    )
                    ON CONFLICT (tenant_id, hotel_id, incident_id)
                    DO UPDATE SET
                        last_observed_at = EXCLUDED.last_observed_at,
                        row_version = ota.ota_incident.row_version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    incident.incidentId(),
                    incident.channel().name(),
                    incident.direction().name(),
                    correlationKey,
                    utc(incident.detectedAt()),
                    utc(incident.detectedAt()));
            var occurrenceId = deterministicId(
                    "incident-occurrence|" + job.simulationRunId() + "|"
                            + incident.incidentId() + "|" + result.cutoffAt());
            var eventData = json(Map.of(
                    "environment", "SIMULATION",
                    "deliveryState", "DELIVERY_BLOCKED",
                    "otaProductId", incident.otaProductId(),
                    "productName", incident.productName(),
                    "physicalRoomTypeName", incident.physicalRoomTypeName(),
                    "pmsAvailable", incident.pmsAvailable(),
                    "otaAvailable", incident.otaAvailable(),
                    "difference", incident.difference()));
            jdbc.update("""
                    INSERT INTO ota.ota_incident_occurrence(
                        tenant_id, hotel_id, incident_id, occurrence_id,
                        occurrence_type, occurred_at, source_observed_at,
                        evidence_hash, evidence_ref, actor_service_principal_id,
                        event_data
                    ) VALUES (
                        ?, ?, ?, ?, 'DETECTED', ?, ?, ?, ?, ?, CAST(? AS jsonb)
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, incident_id, occurrence_id
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    incident.incidentId(),
                    occurrenceId,
                    utc(incident.detectedAt()),
                    utc(incident.detectedAt()),
                    sha256(eventData),
                    "fixture://sprint1/reconciliation",
                    workerServicePrincipalId,
                    eventData);

            var task = result.tasks().get(index);
            jdbc.update("""
                    INSERT INTO ota.ota_task(
                        tenant_id, hotel_id, task_id, incident_id, task_type,
                        status, created_at, sla_due_at
                    ) VALUES (?, ?, ?, ?, 'P1_RESPONSE', 'OPEN', ?, ?)
                    ON CONFLICT (tenant_id, hotel_id, task_id) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    task.taskId(),
                    task.incidentId(),
                    utc(task.createdAt()),
                    utc(task.dueAt()));
            var taskEventData = json(Map.of(
                    "environment", "SIMULATION",
                    "deliveryState", "DELIVERY_BLOCKED",
                    "slaMinutes", 10));
            jdbc.update("""
                    INSERT INTO ota.ota_task_event(
                        tenant_id, hotel_id, task_id, task_event_id,
                        event_type, occurred_at, actor_type,
                        actor_service_principal_id, reason_code, event_data
                    ) VALUES (
                        ?, ?, ?, ?, 'CREATED', ?, 'SERVICE', ?,
                        'SIMULATION_P1_DETECTED', CAST(? AS jsonb)
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, task_id, task_event_id
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    task.taskId(),
                    deterministicId("task-event|" + task.taskId() + "|created"),
                    utc(task.createdAt()),
                    workerServicePrincipalId,
                    taskEventData);
        }

        var targetIds = jdbc.query("""
                SELECT notification_target_id
                  FROM ota.notification_target
                 WHERE tenant_id = ?
                   AND hotel_id = ?
                   AND target_type = 'HOTEL_OPERATION_GROUP'
                   AND transport_mode = 'SIMULATION_ONLY'
                   AND NOT external_delivery_allowed
                   AND status = 'ACTIVE'
                """,
                (row, ignored) -> row.getObject("notification_target_id", UUID.class),
                job.scope().tenantId(),
                job.scope().hotelId());
        if (targetIds.size() != 1) {
            throw new IllegalStateException("SIMULATION_NOTIFICATION_TARGET_NOT_UNIQUE");
        }
        var targetId = targetIds.getFirst();

        for (int index = 0; index < result.outboxPreviews().size(); index++) {
            var preview = result.outboxPreviews().get(index);
            UUID aggregateId;
            String aggregateType;
            String eventType;
            UUID incidentId = null;
            if (preview.messageType().startsWith("HOURLY_BRIEF")) {
                aggregateId = published.briefId();
                aggregateType = "OTA_HOURLY_BRIEF";
                eventType = "ota.simulation.hourly-brief.previewed.v1";
            } else {
                var incident = result.reconciliation().incidents().get(index - 1);
                aggregateId = incident.incidentId();
                incidentId = incident.incidentId();
                aggregateType = "OTA_INCIDENT";
                eventType = "ota.simulation.p1.previewed.v1";
            }
            var payload = json(Map.of(
                    "environment", preview.environment().name(),
                    "deliveryState", preview.deliveryState().name(),
                    "messageType", preview.messageType(),
                    "businessMessageKey", preview.businessMessageKey(),
                    "frozenBody", preview.frozenBody(),
                    "contentSha256", preview.contentSha256(),
                    "mentionAll", preview.mentionAll(),
                    "externalNetworkAttempted", false));
            jdbc.update("""
                    INSERT INTO ota.ota_outbox_event(
                        tenant_id, hotel_id, event_id, event_type,
                        schema_version, source_system, aggregate_type,
                        aggregate_id, aggregate_version, occurred_at,
                        idempotency_key, payload_json
                    ) VALUES (
                        ?, ?, ?, ?, 1, 'OTA_SIMULATION', ?, ?, 1, ?, ?, CAST(? AS jsonb)
                    )
                    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    preview.eventId(),
                    eventType,
                    aggregateType,
                    aggregateId,
                    utc(preview.createdAt()),
                    preview.businessMessageKey(),
                    payload);

            var deliveryId = deterministicId(
                    "notification-delivery|" + preview.businessMessageKey());
            var shortCode = "SIM-" + preview.eventId().toString()
                    .replace("-", "").substring(0, 12)
                    .toUpperCase(java.util.Locale.ROOT);
            jdbc.update("""
                    INSERT INTO ota.notification_delivery(
                        tenant_id, hotel_id, delivery_id, notification_target_id,
                        notification_type, hourly_brief_id, incident_id,
                        outbox_event_id, idempotency_key, message_short_code,
                        frozen_payload, payload_hash, original_cutoff_at,
                        transport_mode, external_delivery_allowed, delivery_status,
                        available_at, attempt_count, final_outcome_code, completed_at
                    ) VALUES (
                        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        'SIMULATION_ONLY', FALSE, 'SIMULATED',
                        ?, 0, 'DELIVERY_BLOCKED', ?
                    )
                    ON CONFLICT (tenant_id, hotel_id, idempotency_key) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    deliveryId,
                    targetId,
                    preview.messageType().startsWith("HOURLY_BRIEF")
                            ? "HOURLY_BRIEF" : "P1_ALERT",
                    preview.messageType().startsWith("HOURLY_BRIEF")
                            ? published.briefId() : null,
                    incidentId,
                    preview.eventId(),
                    preview.businessMessageKey(),
                    shortCode,
                    preview.frozenBody(),
                    preview.contentSha256(),
                    preview.messageType().startsWith("HOURLY_BRIEF")
                            ? utc(result.cutoffAt()) : null,
                    utc(preview.createdAt()),
                    utc(completedAt));
            jdbc.update("""
                    INSERT INTO ota.notification_delivery_attempt(
                        tenant_id, hotel_id, delivery_id, delivery_attempt_id,
                        attempt_no, transport_mode, external_network_attempted,
                        outcome_code, sanitized_error_code, response_fingerprint,
                        attempted_at, finished_at
                    ) VALUES (
                        ?, ?, ?, ?, 1, 'SIMULATION_ONLY', FALSE,
                        'SIMULATED', 'DELIVERY_BLOCKED', ?, ?, ?
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, delivery_id, attempt_no
                    ) DO NOTHING
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    deliveryId,
                    deterministicId("delivery-attempt|" + deliveryId + "|1"),
                    "SIMULATION-NO-NETWORK",
                    utc(preview.createdAt()),
                    utc(completedAt));
        }
    }

    private void advanceCheckpoints(
            ClaimedSimulationJob job,
            SimulationRunResult result,
            Map<CollectionResult, PersistedCollectionRun> runIds,
            Instant completedAt) {
        for (var entry : runIds.entrySet()) {
            var collection = entry.getKey();
            var run = entry.getValue();
            var sourceFreshness = result.freshness().get(run.source());
            var watermark = collection.candidateWatermark()
                    .map(value -> json(Map.of(
                            "type", value.type(),
                            "opaqueValue", value.opaqueValue(),
                            "sourceUpdatedAt", value.sourceUpdatedAt().toString())))
                    .orElse(null);
            var period = run.source() == SourceSystem.PMS
                    ? Duration.ofMinutes(5) : Duration.ofMinutes(15);
            var staleAfter = collection.observedAt()
                    .plus(period.multipliedBy(2))
                    .plus(Duration.ofMinutes(2));
            if (collection.status() != CollectionStatus.SUCCESS
                    || collection.quality().completeness()
                            != cn.sifangguan.ota.contracts.quality
                                    .CompletenessState.COMPLETE) {
                jdbc.update("""
                        INSERT INTO ota.connector_stream_checkpoint(
                            tenant_id, hotel_id, connector_id, stream_code,
                            committed_watermark, committed_run_id, committed_at,
                            last_success_at, last_observed_at, freshness_state,
                            consecutive_failure_count, stale_after, last_reason_code
                        ) VALUES (
                            ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?,
                            'UNAVAILABLE', 1, ?, 'SOURCE_FAILED'
                        )
                        ON CONFLICT (
                            tenant_id, hotel_id, connector_id, stream_code
                        ) DO UPDATE SET
                            last_observed_at = EXCLUDED.last_observed_at,
                            freshness_state = 'UNAVAILABLE',
                            consecutive_failure_count =
                                ota.connector_stream_checkpoint
                                    .consecutive_failure_count + 1,
                            stale_after = EXCLUDED.stale_after,
                            last_reason_code = 'SOURCE_FAILED',
                            row_version =
                                ota.connector_stream_checkpoint.row_version + 1,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        job.scope().tenantId(),
                        job.scope().hotelId(),
                        run.connector().connectorId(),
                        run.stream().name(),
                        utc(collection.observedAt()),
                        utc(staleAfter));
                continue;
            }
            jdbc.update("""
                    INSERT INTO ota.connector_stream_checkpoint(
                        tenant_id, hotel_id, connector_id, stream_code,
                        committed_watermark, committed_run_id, committed_at,
                        last_success_at, last_observed_at, freshness_state,
                        consecutive_failure_count, stale_after, last_reason_code
                    ) VALUES (
                        ?, ?, ?, ?, CAST(? AS jsonb), ?, ?, ?, ?, ?, 0, ?, NULL
                    )
                    ON CONFLICT (
                        tenant_id, hotel_id, connector_id, stream_code
                    ) DO UPDATE SET
                        committed_watermark = EXCLUDED.committed_watermark,
                        committed_run_id = EXCLUDED.committed_run_id,
                        committed_at = EXCLUDED.committed_at,
                        last_success_at = EXCLUDED.last_success_at,
                        last_observed_at = EXCLUDED.last_observed_at,
                        freshness_state = EXCLUDED.freshness_state,
                        consecutive_failure_count = 0,
                        stale_after = EXCLUDED.stale_after,
                        last_reason_code = NULL,
                        row_version = ota.connector_stream_checkpoint.row_version + 1,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                    job.scope().tenantId(),
                    job.scope().hotelId(),
                    run.connector().connectorId(),
                    run.stream().name(),
                    watermark,
                    run.runId(),
                    utc(completedAt),
                    utc(collection.observedAt()),
                    utc(collection.observedAt()),
                    sourceFreshness.fresh() ? "FRESH" : "UNAVAILABLE",
                    utc(staleAfter));
        }
    }

    private void assertLeaseStillValid(
            ClaimedSimulationJob job,
            UUID workerServicePrincipalId,
            Instant now) {
        var renewed = jdbc.queryForObject(
                "SELECT control.renew_ota_job_lease(?, ?, ?, ?, ?)",
                Boolean.class,
                job.jobId(),
                job.leaseId(),
                workerServicePrincipalId,
                utc(now),
                utc(now.plus(Duration.ofMinutes(5))));
        if (!Boolean.TRUE.equals(renewed)) {
            throw new IllegalStateException("SIMULATION_JOB_LEASE_LOST");
        }
    }

    private void completeJob(
            ClaimedSimulationJob job,
            UUID workerServicePrincipalId,
            Instant now,
            String outcomeCode,
            String failureCode) {
        var completed = jdbc.queryForObject(
                "SELECT control.complete_ota_job(?, ?, ?, ?, ?, ?)",
                Boolean.class,
                job.jobId(),
                job.leaseId(),
                workerServicePrincipalId,
                utc(now),
                outcomeCode,
                failureCode);
        if (!Boolean.TRUE.equals(completed)) {
            throw new IllegalStateException("SIMULATION_JOB_COMPLETION_REJECTED");
        }
    }

    private <T> T tenantTransaction(UUID tenantId, Supplier<T> operation) {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(operation, "operation");
        return transactions.execute(status -> {
            setTenant(tenantId);
            return operation.get();
        });
    }

    private void setTenant(UUID tenantId) {
        var configured = jdbc.queryForObject(
                "SELECT set_config('app.tenant_id', ?, true)",
                String.class,
                tenantId.toString());
        if (!tenantId.toString().equals(configured)) {
            throw new IllegalStateException("TENANT_CONTEXT_NOT_SET");
        }
    }

    private CollectionResult findCollection(
            SimulationRunResult result,
            SourceSystem source,
            DataStreamType stream) {
        var matches = result.collections().getOrDefault(source, List.of()).stream()
                .filter(collection -> collection.records().stream()
                        .findFirst()
                        .map(envelope -> envelope.stream() == stream)
                        .orElse(false))
                .toList();
        if (matches.size() != 1) {
            throw new IllegalStateException(
                    "SIMULATION_COLLECTION_NOT_UNIQUE_" + source + "_" + stream);
        }
        return matches.getFirst();
    }

    @SuppressWarnings("unchecked")
    private <T extends StandardRecord> List<StandardRecordEnvelope<T>> typedEnvelopes(
            CollectionResult collection,
            Class<T> recordType) {
        var typed = new ArrayList<StandardRecordEnvelope<T>>();
        for (var envelope : collection.records()) {
            if (!recordType.isInstance(envelope.record())) {
                throw new IllegalStateException(
                        "SIMULATION_RECORD_TYPE_MISMATCH_" + recordType.getSimpleName());
            }
            typed.add((StandardRecordEnvelope<T>) envelope);
        }
        return List.copyOf(typed);
    }

    private Instant collectionWindowFrom(
            DataStreamType stream,
            Instant cutoffAt) {
        if (stream == DataStreamType.BOOKING_EVENT
                || stream == DataStreamType.CANCELLATION_EVENT) {
            return BuiltInSimulationFixture.BUSINESS_DAY_STARTED_AT
                    .minus(Duration.ofHours(1));
        }
        return cutoffAt.minus(Duration.ofHours(2));
    }

    private String normalizedPayload(StandardRecord record) {
        var payload = new LinkedHashMap<String, Object>();
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
            payload.put("effectiveAvailable", value.effectiveAvailable().orElse(null));
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else if (record instanceof BookingRevisionRecord value) {
            payload.put("externalBookingIdHash", sha256(value.externalBookingId()));
            payload.put("revisionKeyHash", sha256(value.revisionKey()));
            payload.put("eventAt", value.eventAt());
            payload.put("eventBusinessDate", value.eventBusinessDate());
            payload.put("beforeRoomNights", normalizedRoomNights(value.beforeRoomNights()));
            payload.put("afterRoomNights", normalizedRoomNights(value.afterRoomNights()));
            payload.put("wholeOrderCancellation", value.wholeOrderCancellation());
            payload.put("sourceUpdatedAt", value.sourceUpdatedAt());
        } else {
            payload.put("sourceRecordKeyHash", sha256(record.sourceRecordKey()));
            payload.put("sourceUpdatedAt", record.sourceUpdatedAt());
        }
        return json(payload);
    }

    private List<Map<String, Object>> normalizedRoomNights(
            Map<cn.sifangguan.ota.contracts.record.RoomNightStay, Integer> values) {
        return values.entrySet().stream()
                .map(entry -> {
                    var row = new LinkedHashMap<String, Object>();
                    row.put("inventoryPoolId", entry.getKey().inventoryPoolId());
                    row.put("stayDate", entry.getKey().stayDate());
                    row.put("quantity", entry.getValue());
                    return Map.copyOf(row);
                })
                .toList();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("SIMULATION_JSON_SERIALIZATION_FAILED", exception);
        }
    }

    private static String sha256(String value) {
        Objects.requireNonNull(value, "value");
        try {
            var digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA_256_NOT_AVAILABLE", exception);
        }
    }

    private static UUID deterministicId(String value) {
        return UUID.nameUUIDFromBytes(
                ("ota-sprint1|" + Objects.requireNonNull(value, "value"))
                        .getBytes(StandardCharsets.UTF_8));
    }

    private static OffsetDateTime utc(Instant instant) {
        return OffsetDateTime.ofInstant(
                Objects.requireNonNull(instant, "instant"),
                ZoneOffset.UTC);
    }

    private static String normalizeReason(String reason) {
        var normalized = Objects.requireNonNullElse(reason, "UNAVAILABLE")
                .trim()
                .toUpperCase(java.util.Locale.ROOT)
                .replaceAll("[^A-Z0-9]+", "_")
                .replaceAll("^_+|_+$", "");
        if (normalized.isBlank()) {
            normalized = "UNAVAILABLE";
        }
        return normalized.substring(0, Math.min(normalized.length(), 96));
    }

    private static void requireFailureCode(String failureCode) {
        if (failureCode == null || !failureCode.matches("[A-Z0-9_]{1,96}")) {
            throw new IllegalArgumentException(
                    "failureCode must match [A-Z0-9_]{1,96}");
        }
    }

    static String bookingRevisionKeyHash(BookingRevisionRecord revision) {
        Objects.requireNonNull(revision, "revision");
        return sha256(revision.sourceRecordKey());
    }

    static Integer nullableSellableRoomCount(InventoryAvailabilityRecord record) {
        return nullableSellableRoomCount(record, true);
    }

    static Integer nullableSellableRoomCount(
            InventoryAvailabilityRecord record,
            boolean sourceAvailable) {
        Objects.requireNonNull(record, "record");
        if (!sourceAvailable) {
            return null;
        }
        return record.effectiveAvailable().orElse(null);
    }

    static String inventoryItemQuality(
            InventoryAvailabilityRecord record,
            boolean mappingPresent) {
        return inventoryItemQuality(record, mappingPresent, true);
    }

    static String inventoryItemQuality(
            InventoryAvailabilityRecord record,
            boolean mappingPresent,
            boolean sourceAvailable) {
        Objects.requireNonNull(record, "record");
        if (!sourceAvailable) {
            return "UNAVAILABLE";
        }
        if (record.effectiveAvailable().isEmpty()) {
            return "UNAVAILABLE";
        }
        if (!mappingPresent) {
            return "MAPPING_MISSING";
        }
        return "COMPLETE";
    }

    static String inventoryItemReason(
            InventoryAvailabilityRecord record,
            boolean mappingPresent) {
        return inventoryItemReason(record, mappingPresent, true);
    }

    static String inventoryItemReason(
            InventoryAvailabilityRecord record,
            boolean mappingPresent,
            boolean sourceAvailable) {
        Objects.requireNonNull(record, "record");
        if (!sourceAvailable) {
            return "SOURCE_UNAVAILABLE";
        }
        if (record.effectiveAvailable().isEmpty()) {
            return mappingPresent
                    ? "AVAILABLE_UNKNOWN"
                    : "MAPPING_AND_AVAILABLE_UNKNOWN";
        }
        return mappingPresent ? null : "MAPPING_MISSING";
    }

    static boolean collectionSourceAvailable(CollectionResult collection) {
        Objects.requireNonNull(collection, "collection");
        return collection.status() != CollectionStatus.FAILED
                && collection.status() != CollectionStatus.AUTH_REQUIRED
                && collection.quality().dataQuality()
                        != cn.sifangguan.ota.contracts.quality.DataQualityState.UNAVAILABLE
                && collection.quality().completeness()
                        != cn.sifangguan.ota.contracts.quality.CompletenessState.UNAVAILABLE;
    }

    static void requireExistingBriefForReplay(
            SimulationScenarioCode scenarioCode,
            boolean existingBriefPresent) {
        Objects.requireNonNull(scenarioCode, "scenarioCode");
        if (scenarioCode == SimulationScenarioCode.LATE_BRIEF_REPLAY
                && !existingBriefPresent) {
            throw new IllegalStateException(
                    "LATE_BRIEF_REPLAY_REQUIRES_ORIGINAL_BRIEF");
        }
    }

    static String metricQualityCode(MetricState state) {
        return switch (Objects.requireNonNull(state, "state")) {
            case AVAILABLE -> "AVAILABLE";
            case NOT_APPLICABLE -> "NOT_APPLICABLE";
            case NOT_CONFIGURED -> "NOT_CONFIGURED";
            case UNAVAILABLE, CONSISTENCY_ERROR -> "UNAVAILABLE";
        };
    }

    static String metricReasonCode(MetricValue metric) {
        Objects.requireNonNull(metric, "metric");
        return metric.state() == MetricState.AVAILABLE
                ? null
                : normalizeReason(metric.reason());
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

    private record HydratedRun(
            Instant fixedClockAt,
            String scenarioCode,
            String timezone,
            String hotelName) {
    }

    private record ConfiguredPoolRow(
            String poolCode,
            String displayName,
            String sourceProductKeyHash) {
    }

    private record ConfiguredProductMappingRow(
            SourceSystem source,
            String sourceProductKeyHash,
            String poolCode,
            long version) {
    }

    private record ConfiguredTargetRow(
            long version,
            BigDecimal roomRevenue,
            BigDecimal targetAdr) {
    }

    private record ConfiguredPaceRow(
            long version,
            BigDecimal revenueProgressPercent,
            BigDecimal sellProgressPercent) {
    }

    private record ExpectedMapping(
            SourceSystem source,
            String sourceKey,
            String poolCode) {
    }

    private record PersistedCollectionRun(
            UUID runId,
            SourceSystem source,
            DataStreamType stream,
            DatabaseConnectorContext connector) {
    }

    private record BusinessDayIds(
            UUID observationId,
            UUID businessDayRunId) {
    }

    private record PersistedMapping(
            UUID mappingVersionId,
            UUID inventoryPoolId) {
    }

    private record PublishedSnapshot(
            UUID snapshotId,
            UUID briefId,
            String shortCode) {
    }

    private record ExistingBrief(
            UUID briefId,
            UUID snapshotId,
            String shortCode) {
    }
}
