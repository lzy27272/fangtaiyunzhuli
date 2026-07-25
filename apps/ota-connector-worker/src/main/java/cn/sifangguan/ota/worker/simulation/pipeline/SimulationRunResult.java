package cn.sifangguan.ota.worker.simulation.pipeline;

import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.worker.simulation.domain.ChannelBookingSummary;
import cn.sifangguan.ota.worker.simulation.domain.HourlyMetrics;
import cn.sifangguan.ota.worker.simulation.domain.InventoryIncident;
import cn.sifangguan.ota.worker.simulation.domain.InventoryReconciliationResult;
import cn.sifangguan.ota.worker.simulation.domain.MappedInventorySnapshot;
import cn.sifangguan.ota.worker.simulation.domain.RoomNightDelta;
import cn.sifangguan.ota.worker.simulation.domain.SimulationOutboxPreview;
import cn.sifangguan.ota.worker.simulation.domain.SimulationTask;
import cn.sifangguan.ota.worker.simulation.domain.SourceFreshness;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record SimulationRunResult(
        UUID runId,
        SimulationScenarioCode scenarioCode,
        LocalDate businessDate,
        Instant cutoffAt,
        CompletenessState completeness,
        Map<SourceSystem, List<CollectionResult>> collections,
        Map<SourceSystem, SourceFreshness> freshness,
        MappedInventorySnapshot inventory,
        List<RoomNightDelta> roomNightDeltas,
        Map<SourceSystem, ChannelBookingSummary> bookingSummaries,
        HourlyMetrics metrics,
        InventoryReconciliationResult reconciliation,
        List<SimulationTask> tasks,
        String frozenHourlyBrief,
        List<SimulationOutboxPreview> outboxPreviews) {

    public SimulationRunResult {
        Objects.requireNonNull(runId, "runId");
        Objects.requireNonNull(scenarioCode, "scenarioCode");
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(cutoffAt, "cutoffAt");
        Objects.requireNonNull(completeness, "completeness");
        collections = immutableLists(collections);
        freshness = Map.copyOf(Objects.requireNonNull(freshness, "freshness"));
        Objects.requireNonNull(inventory, "inventory");
        roomNightDeltas = List.copyOf(
                Objects.requireNonNull(roomNightDeltas, "roomNightDeltas"));
        bookingSummaries = Map.copyOf(
                Objects.requireNonNull(bookingSummaries, "bookingSummaries"));
        Objects.requireNonNull(metrics, "metrics");
        Objects.requireNonNull(reconciliation, "reconciliation");
        tasks = List.copyOf(Objects.requireNonNull(tasks, "tasks"));
        frozenHourlyBrief = Objects.requireNonNull(frozenHourlyBrief, "frozenHourlyBrief");
        if (frozenHourlyBrief.isBlank()) {
            throw new IllegalArgumentException("frozenHourlyBrief must not be blank");
        }
        outboxPreviews = List.copyOf(
                Objects.requireNonNull(outboxPreviews, "outboxPreviews"));
    }

    private static Map<SourceSystem, List<CollectionResult>> immutableLists(
            Map<SourceSystem, List<CollectionResult>> source) {
        Objects.requireNonNull(source, "collections");
        var copy = new java.util.EnumMap<SourceSystem, List<CollectionResult>>(SourceSystem.class);
        source.forEach((key, value) -> copy.put(
                Objects.requireNonNull(key, "collection source"),
                List.copyOf(Objects.requireNonNull(value, "collection results"))));
        return Map.copyOf(copy);
    }
}
