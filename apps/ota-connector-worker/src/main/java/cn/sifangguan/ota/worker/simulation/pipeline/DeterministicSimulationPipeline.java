package cn.sifangguan.ota.worker.simulation.pipeline;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionWindow;
import cn.sifangguan.ota.contracts.collection.ConnectorError;
import cn.sifangguan.ota.contracts.collection.PmsBusinessDayContext;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import cn.sifangguan.ota.contracts.record.RoomNightStay;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.simulation.domain.BookingDeltaCalculator;
import cn.sifangguan.ota.worker.simulation.domain.BookingSummaryCalculator;
import cn.sifangguan.ota.worker.simulation.domain.ChannelBookingSummary;
import cn.sifangguan.ota.worker.simulation.domain.HourlyBriefFormatter;
import cn.sifangguan.ota.worker.simulation.domain.HourlyMetricCalculator;
import cn.sifangguan.ota.worker.simulation.domain.InventoryMappingService;
import cn.sifangguan.ota.worker.simulation.domain.InventoryReconciliationService;
import cn.sifangguan.ota.worker.simulation.domain.RoomNightDelta;
import cn.sifangguan.ota.worker.simulation.domain.SimulationOutboxFactory;
import cn.sifangguan.ota.worker.simulation.domain.SimulationTaskFactory;
import cn.sifangguan.ota.worker.simulation.domain.SourceFreshness;
import cn.sifangguan.ota.worker.simulation.domain.SourceFreshnessEvaluator;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;

/**
 * Pure deterministic Sprint 1 orchestration. It has no persistence and no delivery
 * dependency; adapters may persist its immutable result as one transaction.
 */
public final class DeterministicSimulationPipeline {
    private static final Duration PMS_PERIOD = Duration.ofMinutes(5);
    private static final Duration OTA_PERIOD = Duration.ofMinutes(15);
    private static final Duration SNAPSHOT_SKEW = Duration.ofMinutes(2);

    private final SourceConnectorRegistry registry;
    private final Clock clock;
    private final SourceFreshnessEvaluator freshnessEvaluator = new SourceFreshnessEvaluator();
    private final InventoryMappingService mappingService = new InventoryMappingService();
    private final BookingDeltaCalculator bookingDeltaCalculator = new BookingDeltaCalculator();
    private final BookingSummaryCalculator bookingSummaryCalculator =
            new BookingSummaryCalculator();
    private final HourlyMetricCalculator metricCalculator = new HourlyMetricCalculator();
    private final InventoryReconciliationService reconciliationService =
            new InventoryReconciliationService();
    private final SimulationTaskFactory taskFactory = new SimulationTaskFactory();
    private final HourlyBriefFormatter briefFormatter = new HourlyBriefFormatter();
    private final SimulationOutboxFactory outboxFactory = new SimulationOutboxFactory();

    public DeterministicSimulationPipeline(SourceConnectorRegistry registry, Clock clock) {
        this.registry = Objects.requireNonNull(registry, "registry");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public SimulationRunResult run(SimulationRunCommand command) {
        Objects.requireNonNull(command, "command");
        var cutoff = BuiltInSimulationFixture.CUTOFF_AT;
        var now = Instant.now(clock);
        var runId = command.simulationRunId();

        var pms = registry.require(SimulationPmsConnector.CONNECTOR_CODE);
        var ctrip = registry.require(SimulationCtripConnector.CONNECTOR_CODE);
        var meituan = registry.require(SimulationMeituanConnector.CONNECTOR_CODE);

        var pmsBusinessDay = collect(
                command, pms, DataStreamType.BUSINESS_DATE,
                cutoff.minus(Duration.ofHours(2)), cutoff, Optional.empty());
        var businessRecord = records(pmsBusinessDay, PmsBusinessDateRecord.class).stream()
                .max(java.util.Comparator.comparing(PmsBusinessDateRecord::sourceUpdatedAt))
                .orElseThrow(() -> new IllegalStateException(
                        "simulation PMS business date fixture is missing"));
        var businessContext = Optional.of(new PmsBusinessDayContext(
                businessRecord.businessDate(), pmsBusinessDay.observedAt()));

        var pmsOperating = collect(
                command, pms, DataStreamType.ROOM_REVENUE_AGGREGATE,
                cutoff.minus(Duration.ofHours(2)), cutoff, businessContext);
        var pmsInventory = collect(
                command, pms, DataStreamType.INVENTORY_ROOM_TYPE,
                cutoff.minus(Duration.ofHours(2)), cutoff, businessContext);
        var ctripInventory = collect(
                command, ctrip, DataStreamType.INVENTORY_SELL_PRODUCT,
                cutoff.minus(Duration.ofHours(2)), cutoff, businessContext);
        var ctripBooking = collect(
                command, ctrip, DataStreamType.BOOKING_EVENT,
                BuiltInSimulationFixture.BUSINESS_DAY_STARTED_AT.minusSeconds(1),
                cutoff, businessContext);
        var meituanInventory = collect(
                command, meituan, DataStreamType.INVENTORY_SELL_PRODUCT,
                cutoff.minus(Duration.ofHours(2)), cutoff, businessContext);
        var meituanBooking = collect(
                command, meituan, DataStreamType.BOOKING_EVENT,
                BuiltInSimulationFixture.BUSINESS_DAY_STARTED_AT.minusSeconds(1),
                cutoff, businessContext);

        var collections = new EnumMap<SourceSystem, List<CollectionResult>>(SourceSystem.class);
        collections.put(SourceSystem.PMS, List.of(
                pmsBusinessDay, pmsOperating, pmsInventory));
        collections.put(SourceSystem.CTRIP, List.of(ctripInventory, ctripBooking));
        collections.put(SourceSystem.MEITUAN, List.of(meituanInventory, meituanBooking));

        var freshness = new EnumMap<SourceSystem, SourceFreshness>(SourceSystem.class);
        freshness.put(SourceSystem.PMS, freshnessEvaluator.evaluate(
                SourceSystem.PMS, collections.get(SourceSystem.PMS), PMS_PERIOD, now));
        freshness.put(SourceSystem.CTRIP, freshnessEvaluator.evaluate(
                SourceSystem.CTRIP, collections.get(SourceSystem.CTRIP), OTA_PERIOD, now));
        freshness.put(SourceSystem.MEITUAN, freshnessEvaluator.evaluate(
                SourceSystem.MEITUAN, collections.get(SourceSystem.MEITUAN), OTA_PERIOD, now));

        var mappedInventory = mappingService.map(
                command.configuration().inventoryPools(),
                command.configuration().productMappings(),
                envelopes(pmsInventory, InventoryAvailabilityRecord.class),
                concat(
                        envelopes(ctripInventory, InventoryAvailabilityRecord.class),
                        envelopes(meituanInventory, InventoryAvailabilityRecord.class)));

        var deltas = new ArrayList<RoomNightDelta>();
        deltas.addAll(bookingDeltaCalculator.expand(
                SourceSystem.CTRIP,
                remapBookingPools(
                        records(ctripBooking, BookingRevisionRecord.class),
                        command.configuration())));
        deltas.addAll(bookingDeltaCalculator.expand(
                SourceSystem.MEITUAN,
                remapBookingPools(
                        records(meituanBooking, BookingRevisionRecord.class),
                        command.configuration())));
        var summaries = new EnumMap<SourceSystem, ChannelBookingSummary>(SourceSystem.class);
        summaries.put(SourceSystem.CTRIP, bookingSummaryCalculator.summarize(
                SourceSystem.CTRIP,
                deltas,
                businessRecord.businessDate(),
                cutoff.minus(Duration.ofHours(1)),
                cutoff));
        summaries.put(SourceSystem.MEITUAN, bookingSummaryCalculator.summarize(
                SourceSystem.MEITUAN,
                deltas,
                businessRecord.businessDate(),
                cutoff.minus(Duration.ofHours(1)),
                cutoff));

        var operating = records(pmsOperating, PmsOperatingRecord.class);
        var current = operating.stream()
                .filter(record -> record.asOf().equals(cutoff))
                .findFirst();
        var previous = operating.stream()
                .filter(record -> record.asOf().equals(cutoff.minus(Duration.ofHours(1))))
                .findFirst();
        var metrics = metricCalculator.calculate(
                businessRecord.businessDate(),
                cutoff,
                current,
                previous,
                Optional.of(command.configuration().revenuePace()),
                OptionalLong.of(command.configuration().revenuePace().version()),
                freshness.get(SourceSystem.PMS).fresh());

        var sourceFresh = Map.of(
                SourceSystem.PMS, freshness.get(SourceSystem.PMS).fresh(),
                SourceSystem.CTRIP, freshness.get(SourceSystem.CTRIP).fresh(),
                SourceSystem.MEITUAN, freshness.get(SourceSystem.MEITUAN).fresh());
        var reconciliation = reconciliationService.reconcile(
                mappedInventory, sourceFresh, SNAPSHOT_SKEW, now);
        var tasks = taskFactory.create(reconciliation.incidents());
        var completeness = completeness(freshness, mappedInventory.mappingIssues());
        var brief = briefFormatter.format(
                command.hotelName(),
                command.configuration().hotelZone(),
                metrics,
                Optional.of(command.configuration().revenuePace()),
                mappedInventory,
                reconciliation.incidents(),
                freshness,
                completeness,
                summaries.get(SourceSystem.CTRIP),
                summaries.get(SourceSystem.MEITUAN));
        var outbox = outboxFactory.create(
                command.scope(),
                businessRecord.businessDate(),
                cutoff,
                brief,
                reconciliation.incidents(),
                now,
                command.simulationRunId(),
                command.scenarioCode() == SimulationScenarioCode.LATE_BRIEF_REPLAY);

        return new SimulationRunResult(
                runId,
                command.scenarioCode(),
                businessRecord.businessDate(),
                cutoff,
                completeness,
                collections,
                freshness,
                mappedInventory,
                deltas,
                summaries,
                metrics,
                reconciliation,
                tasks,
                brief,
                outbox);
    }

    private CollectionResult collect(
            SimulationRunCommand command,
            SourceConnector connector,
            DataStreamType stream,
            Instant fromExclusive,
            Instant cutoff,
            Optional<PmsBusinessDayContext> businessContext) {
        var identity = command.scope().tenantId() + "|"
                + command.scope().hotelId() + "|"
                + command.scenarioCode() + "|" + command.simulationRunId() + "|"
                + connector.descriptor().sourceSystem() + "|" + stream + "|" + cutoff;
        var collected = connector.collect(new CollectionRequest(
                command.scope(),
                deterministicId("connector|" + command.scope().hotelId() + "|"
                        + connector.descriptor().connectorCode()),
                1,
                deterministicId("collection|" + identity),
                stream,
                CollectionTrigger.HOURLY_COORDINATION,
                new CollectionWindow(fromExclusive, cutoff),
                Optional.empty(),
                businessContext,
                cutoff,
                connector.descriptor().sourceSystem() == SourceSystem.PMS
                        ? Duration.ofSeconds(120)
                        : Duration.ofSeconds(240),
                new TraceContext(
                        "simulation-trace-" + shortHash(identity),
                        "simulation-correlation-" + shortHash(
                                command.scope().hotelId() + "|" + cutoff))));
        return applyScenario(
                command.scenarioCode(),
                connector.descriptor().sourceSystem(),
                stream,
                collected);
    }

    private CollectionResult applyScenario(
            SimulationScenarioCode scenario,
            SourceSystem source,
            DataStreamType stream,
            CollectionResult collected) {
        var records = new ArrayList<StandardRecordEnvelope<?>>();
        for (var envelope : collected.records()) {
            records.add(scenarioEnvelope(
                    scenario,
                    source,
                    stream,
                    envelope));
        }
        if (scenario == SimulationScenarioCode.SOURCE_UNAVAILABLE
                && source == SourceSystem.MEITUAN) {
            return new CollectionResult(
                    CollectionStatus.FAILED,
                    records,
                    Optional.empty(),
                    collected.sourceEffectiveAt(),
                    collected.observedAt(),
                    collected.evidenceReferences(),
                    new CollectionQuality(
                            DataQualityState.UNAVAILABLE,
                            CompletenessState.UNAVAILABLE,
                            ValidationState.FAIL,
                            ValidationState.FAIL,
                            ValidationState.PASS,
                            List.of()),
                    Optional.of(new ConnectorError(
                            "SIMULATED_SOURCE_UNAVAILABLE",
                            true,
                            "deterministic simulation source unavailable")));
        }
        return new CollectionResult(
                collected.status(),
                records,
                collected.candidateWatermark(),
                collected.sourceEffectiveAt(),
                collected.observedAt(),
                collected.evidenceReferences(),
                collected.quality(),
                collected.error());
    }

    private StandardRecordEnvelope<?> scenarioEnvelope(
            SimulationScenarioCode scenario,
            SourceSystem source,
            DataStreamType stream,
            StandardRecordEnvelope<?> envelope) {
        StandardRecord record = envelope.record();
        if (scenario != SimulationScenarioCode.INVENTORY_MISMATCH
                && stream == DataStreamType.INVENTORY_SELL_PRODUCT
                && record instanceof InventoryAvailabilityRecord inventory) {
            var alignedAvailability = switch (inventory.sourceInventoryId()) {
                case "CT-LUX-NO-BREAKFAST" -> 0;
                case "CT-STANDARD-NO-BREAKFAST" -> 8;
                default -> inventory.effectiveAvailable().orElseThrow();
            };
            record = new InventoryAvailabilityRecord(
                    inventory.sourceInventoryId(),
                    inventory.displayName(),
                    inventory.itemKind(),
                    Optional.of(alignedAvailability),
                    inventory.sourceUpdatedAt());
        }
        var scenarioIdentity = envelope.recordId() + "|" + envelope.runId()
                + "|" + scenario + "|" + source + "|" + stream;
        return new StandardRecordEnvelope<>(
                deterministicId("scenario-record|" + scenarioIdentity),
                envelope.schemaVersion(),
                envelope.sourceSystem(),
                envelope.tenantId(),
                envelope.hotelId(),
                envelope.connectorId(),
                envelope.runId(),
                envelope.stream(),
                envelope.sourceEffectiveAt(),
                envelope.sourceDetectionInterval(),
                envelope.observedAt(),
                envelope.idempotencyKey() + ":" + scenario.name().toLowerCase(
                        java.util.Locale.ROOT),
                envelope.evidence(),
                record);
    }

    private static CompletenessState completeness(
            Map<SourceSystem, SourceFreshness> freshness,
            List<String> mappingIssues) {
        if (!freshness.get(SourceSystem.PMS).fresh()) {
            return CompletenessState.UNAVAILABLE;
        }
        if (!freshness.get(SourceSystem.CTRIP).fresh()
                || !freshness.get(SourceSystem.MEITUAN).fresh()
                || !mappingIssues.isEmpty()) {
            return CompletenessState.PARTIAL;
        }
        return CompletenessState.COMPLETE;
    }

    private static <T extends StandardRecord> List<T> records(
            CollectionResult result,
            Class<T> type) {
        return result.records().stream()
                .map(StandardRecordEnvelope::record)
                .filter(type::isInstance)
                .map(type::cast)
                .toList();
    }

    @SuppressWarnings("unchecked")
    private static <T extends StandardRecord> List<StandardRecordEnvelope<T>> envelopes(
            CollectionResult result,
            Class<T> type) {
        return result.records().stream()
                .filter(envelope -> type.isInstance(envelope.record()))
                .map(envelope -> (StandardRecordEnvelope<T>) envelope)
                .toList();
    }

    private static <T> List<T> concat(List<T> left, List<T> right) {
        var values = new ArrayList<T>(left.size() + right.size());
        values.addAll(left);
        values.addAll(right);
        return List.copyOf(values);
    }

    private static List<BookingRevisionRecord> remapBookingPools(
            List<BookingRevisionRecord> revisions,
            SimulationHotelConfiguration configuration) {
        var configuredByPmsSource = new LinkedHashMap<String, String>();
        for (var pool : configuration.inventoryPools()) {
            configuredByPmsSource.put(
                    pool.pmsPhysicalRoomTypeId(),
                    pool.inventoryPoolId());
        }
        var configuredByBuiltInPool = new LinkedHashMap<String, String>();
        for (var builtIn : BuiltInSimulationFixture.inventoryPools()) {
            var configured = configuredByPmsSource.get(
                    builtIn.pmsPhysicalRoomTypeId());
            if (configured == null) {
                throw new IllegalStateException(
                        "SIMULATION_BOOKING_POOL_CONFIG_MISSING");
            }
            configuredByBuiltInPool.put(
                    builtIn.inventoryPoolId(),
                    configured);
        }
        return revisions.stream()
                .map(revision -> new BookingRevisionRecord(
                        revision.externalBookingId(),
                        revision.revisionKey(),
                        revision.eventAt(),
                        revision.eventBusinessDate(),
                        remapRoomNightMultiset(
                                revision.beforeRoomNights(),
                                configuredByBuiltInPool),
                        remapRoomNightMultiset(
                                revision.afterRoomNights(),
                                configuredByBuiltInPool),
                        revision.wholeOrderCancellation(),
                        revision.sourceUpdatedAt()))
                .toList();
    }

    private static Map<RoomNightStay, Integer> remapRoomNightMultiset(
            Map<RoomNightStay, Integer> source,
            Map<String, String> configuredByBuiltInPool) {
        var remapped = new LinkedHashMap<RoomNightStay, Integer>();
        source.forEach((stay, quantity) -> {
            var configuredPool = configuredByBuiltInPool.get(
                    stay.inventoryPoolId());
            if (configuredPool == null) {
                throw new IllegalStateException(
                        "SIMULATION_BOOKING_STAY_POOL_UNMAPPED");
            }
            remapped.merge(
                    new RoomNightStay(configuredPool, stay.stayDate()),
                    quantity,
                    Integer::sum);
        });
        return Map.copyOf(remapped);
    }

    private static UUID deterministicId(String value) {
        return UUID.nameUUIDFromBytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String shortHash(String value) {
        return deterministicId(value).toString().replace("-", "").substring(0, 16);
    }
}
