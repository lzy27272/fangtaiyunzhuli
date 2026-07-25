package cn.sifangguan.ota.worker.simulation.pipeline;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.simulation.domain.OutboxDeliveryState;
import cn.sifangguan.ota.worker.simulation.domain.OutboxEnvironment;
import cn.sifangguan.ota.worker.simulation.domain.RoomNightDeltaReason;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.ZoneOffset;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DeterministicSimulationPipelineTest {
    @Test
    void runsTheCompleteDeterministicClosedLoopWithoutDelivery() {
        var pipeline = pipeline();
        var command = new SimulationRunCommand(
                BuiltInSimulationFixture.DEFAULT_SCOPE,
                BuiltInSimulationFixture.HOTEL_NAME,
                SimulationScenarioCode.INVENTORY_MISMATCH);

        var first = pipeline.run(command);
        var second = pipeline.run(command);

        assertEquals(first, second, "same fixture and clock must produce identical output");
        assertEquals(CompletenessState.COMPLETE, first.completeness());
        assertEquals(BuiltInSimulationFixture.BUSINESS_DATE, first.businessDate());
        assertTrue(first.freshness().values().stream().allMatch(value -> value.fresh()));
        assertEquals(5, first.inventory().physicalAvailableByPool().size());
        assertEquals(7, first.inventory().products().size());
        assertEquals(List.of("景观双床房", "轻奢大床房"),
                first.inventory().soldOutPhysicalRoomTypes());

        assertEquals(2, first.reconciliation().incidents().size());
        assertEquals(2, first.tasks().size());
        assertTrue(first.reconciliation().incidents().stream()
                .anyMatch(value -> value.otaProductId().equals("CT-LUX-NO-BREAKFAST")
                        && value.difference() == 1));
        assertTrue(first.reconciliation().incidents().stream()
                .anyMatch(value -> value.otaProductId().equals("CT-STANDARD-NO-BREAKFAST")
                        && value.difference() == -1));

        assertTrue(first.roomNightDeltas().stream()
                .anyMatch(value -> value.reason() == RoomNightDeltaReason.CANCELLED));
        assertTrue(first.roomNightDeltas().stream()
                .anyMatch(value -> value.reason() == RoomNightDeltaReason.MODIFIED_REMOVE));
        assertEquals(2, first.bookingSummaries().get(
                SourceSystem.CTRIP).hourWindow().addedToday());
        assertEquals(1, first.bookingSummaries().get(
                SourceSystem.CTRIP).hourWindow().removedFuture());

        assertTrue(first.frozenHourlyBrief().contains("📌 今日压力"));
        assertTrue(first.frozenHourlyBrief().contains("🎯 今日进度"));
        assertTrue(first.frozenHourlyBrief().contains("🔄 实时经营对比"));
        assertTrue(first.frozenHourlyBrief().contains("📝 收益判断"));
        assertTrue(first.frozenHourlyBrief().contains("【订单情况汇报】"));
        assertTrue(first.frozenHourlyBrief().contains("AI经营建议："));
        assertTrue(first.frozenHourlyBrief().contains("每时速度｜售卖"));
        assertFalse(first.frozenHourlyBrief().contains("Webhook"));

        assertEquals(3, first.outboxPreviews().size());
        assertTrue(first.outboxPreviews().stream().allMatch(
                value -> value.environment() == OutboxEnvironment.SIMULATION
                        && value.deliveryState() == OutboxDeliveryState.DELIVERY_BLOCKED
                        && value.mentionAll()
                        && value.frozenBody().startsWith(
                                "【SIMULATION｜DELIVERY_BLOCKED】")));
    }

    @Test
    void exposesFourDistinctScenariosAndRunIdentities() {
        var pipeline = pipeline();
        var baseline = run(pipeline, SimulationScenarioCode.BASELINE);
        var mismatch = run(pipeline, SimulationScenarioCode.INVENTORY_MISMATCH);
        var unavailable = run(pipeline, SimulationScenarioCode.SOURCE_UNAVAILABLE);
        var lateReplay = run(pipeline, SimulationScenarioCode.LATE_BRIEF_REPLAY);

        assertEquals(0, baseline.reconciliation().incidents().size());
        assertEquals(1, baseline.outboxPreviews().size());

        assertEquals(2, mismatch.reconciliation().incidents().size());
        assertEquals(3, mismatch.outboxPreviews().size());

        assertEquals(CompletenessState.PARTIAL, unavailable.completeness());
        assertFalse(unavailable.freshness().get(SourceSystem.MEITUAN).fresh());
        assertTrue(unavailable.freshness().get(SourceSystem.MEITUAN)
                .reasons().contains("SOURCE_FAILED"));
        assertTrue(unavailable.reconciliation().incidents().stream()
                .noneMatch(value -> value.channel() == SourceSystem.MEITUAN));

        assertEquals(1, lateReplay.outboxPreviews().size());
        assertEquals(
                "HOURLY_BRIEF_REPLAY",
                lateReplay.outboxPreviews().getFirst().messageType());
        assertTrue(lateReplay.outboxPreviews().getFirst()
                .businessMessageKey().endsWith(":late-replay:1"));
        assertTrue(lateReplay.outboxPreviews().getFirst()
                .frozenBody().contains("【过时简报补发】"));
        assertTrue(lateReplay.outboxPreviews().getFirst()
                .frozenBody().startsWith("【SIMULATION｜DELIVERY_BLOCKED】"));

        assertEquals(4, Set.of(
                baseline.runId(),
                mismatch.runId(),
                unavailable.runId(),
                lateReplay.runId()).size());
    }

    @Test
    void sameScenarioWithDifferentSimulationRunIdsKeepsRunScopedEvidenceDistinct() {
        var pipeline = pipeline();
        var firstRunId =
                UUID.fromString("30000000-0000-0000-0000-000000000011");
        var secondRunId =
                UUID.fromString("30000000-0000-0000-0000-000000000012");

        var first = pipeline.run(new SimulationRunCommand(
                BuiltInSimulationFixture.DEFAULT_SCOPE,
                BuiltInSimulationFixture.HOTEL_NAME,
                SimulationScenarioCode.INVENTORY_MISMATCH,
                firstRunId,
                BuiltInSimulationFixture.defaultConfiguration()));
        var second = pipeline.run(new SimulationRunCommand(
                BuiltInSimulationFixture.DEFAULT_SCOPE,
                BuiltInSimulationFixture.HOTEL_NAME,
                SimulationScenarioCode.INVENTORY_MISMATCH,
                secondRunId,
                BuiltInSimulationFixture.defaultConfiguration()));

        var firstRecordIds = first.collections().values().stream()
                .flatMap(List::stream)
                .flatMap(collection -> collection.records().stream())
                .map(record -> record.recordId())
                .collect(java.util.stream.Collectors.toSet());
        var secondRecordIds = second.collections().values().stream()
                .flatMap(List::stream)
                .flatMap(collection -> collection.records().stream())
                .map(record -> record.recordId())
                .collect(java.util.stream.Collectors.toSet());
        var overlap = new java.util.HashSet<>(firstRecordIds);
        overlap.retainAll(secondRecordIds);

        assertTrue(overlap.isEmpty());
        assertNotEquals(
                first.outboxPreviews().getFirst().businessMessageKey(),
                second.outboxPreviews().getFirst().businessMessageKey());
        assertTrue(first.outboxPreviews().getFirst().businessMessageKey()
                .contains(firstRunId.toString()));
        assertTrue(second.outboxPreviews().getFirst().businessMessageKey()
                .contains(secondRunId.toString()));
    }

    @Test
    void acceptsThirdHotelDatabaseStyleConfigurationWithoutRegistryChanges() {
        var pipeline = pipeline();
        var thirdHotelScope = new cn.sifangguan.ota.contracts.common.TenantHotelRef(
                BuiltInSimulationFixture.DEFAULT_SCOPE.tenantId(),
                UUID.fromString("20000000-0000-0000-0000-000000000003"));
        var configuredPools = BuiltInSimulationFixture.inventoryPools().stream()
                .map(pool -> new cn.sifangguan.ota.worker.simulation.domain
                        .InventoryPoolDefinition(
                                "db-" + pool.inventoryPoolId(),
                                pool.pmsPhysicalRoomTypeId(),
                                pool.inventoryPoolId().equals(
                                        BuiltInSimulationFixture.POOL_VIEW_TWIN)
                                        ? "第三店景观双床房"
                                        : pool.displayName()))
                .toList();
        var configuredMappings = BuiltInSimulationFixture.productMappings().stream()
                .map(mapping -> new cn.sifangguan.ota.worker.simulation.domain
                        .ProductInventoryMapping(
                                mapping.channel(),
                                mapping.otaProductId(),
                                "db-" + mapping.inventoryPoolId(),
                                mapping.version()))
                .toList();
        var configuration = new SimulationHotelConfiguration(
                BuiltInSimulationFixture.HOTEL_ZONE,
                configuredPools,
                configuredMappings,
                new cn.sifangguan.ota.worker.simulation.domain.RevenuePaceConfig(
                        3000001,
                        new java.math.BigDecimal("12000.00"),
                        new java.math.BigDecimal("220.00"),
                        new java.math.BigDecimal("0.80"),
                        new java.math.BigDecimal("0.80")));

        var result = pipeline.run(new SimulationRunCommand(
                thirdHotelScope,
                "第三家模拟门店",
                SimulationScenarioCode.BASELINE,
                UUID.fromString("30000000-0000-0000-0000-000000000003"),
                configuration));

        assertEquals(
                0,
                new java.math.BigDecimal("4151.00").compareTo(
                        result.metrics().targetGap().requiredValue()));
        assertTrue(result.inventory().soldOutPhysicalRoomTypes()
                .contains("第三店景观双床房"));
        assertTrue(result.frozenHourlyBrief().contains("第三家模拟门店"));
        assertTrue(result.inventory().physicalAvailableByPool().keySet().stream()
                .allMatch(poolId -> poolId.startsWith("db-")));
        assertTrue(result.roomNightDeltas().stream()
                .allMatch(delta -> delta.stay().inventoryPoolId().startsWith("db-")));
    }

    private static SimulationRunResult run(
            DeterministicSimulationPipeline pipeline,
            SimulationScenarioCode scenario) {
        return pipeline.run(new SimulationRunCommand(
                BuiltInSimulationFixture.DEFAULT_SCOPE,
                BuiltInSimulationFixture.HOTEL_NAME,
                scenario,
                UUID.nameUUIDFromBytes(("scenario-test|" + scenario)
                        .getBytes(StandardCharsets.UTF_8)),
                BuiltInSimulationFixture.defaultConfiguration()));
    }

    private static DeterministicSimulationPipeline pipeline() {
        var clock = Clock.fixed(BuiltInSimulationFixture.FIXED_NOW, ZoneOffset.UTC);
        return new DeterministicSimulationPipeline(
                new SourceConnectorRegistry(List.<SourceConnector>of(
                        new SimulationPmsConnector(clock),
                        new SimulationCtripConnector(clock),
                        new SimulationMeituanConnector(clock))),
                clock);
    }
}
