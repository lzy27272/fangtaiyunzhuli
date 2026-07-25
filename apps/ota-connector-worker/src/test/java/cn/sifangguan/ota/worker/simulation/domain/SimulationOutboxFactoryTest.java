package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SimulationOutboxFactoryTest {
    private static final UUID TENANT_ID =
            UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID INCIDENT_ID =
            UUID.fromString("90000000-0000-0000-0000-000000000001");
    private static final Instant CUTOFF =
            Instant.parse("2026-07-19T10:00:00Z");

    @Test
    void p1IdempotencyKeyAndEventIdAreIsolatedBetweenHotelsInSameTenant() {
        var firstHotel = new TenantHotelRef(
                TENANT_ID,
                UUID.fromString("20000000-0000-0000-0000-000000000001"));
        var secondHotel = new TenantHotelRef(
                TENANT_ID,
                UUID.fromString("20000000-0000-0000-0000-000000000002"));
        var incident = new InventoryIncident(
                INCIDENT_ID,
                SourceSystem.CTRIP,
                "CT-VIEW",
                "Ctrip view room",
                "pool-view",
                "View room",
                5,
                4,
                -1,
                InventoryRiskDirection.OTA_LESS_THAN_PMS,
                CUTOFF,
                "OPEN");
        var factory = new SimulationOutboxFactory();

        var first = factory.create(
                firstHotel,
                LocalDate.of(2026, 7, 19),
                CUTOFF,
                "【SIMULATION｜DELIVERY_BLOCKED】\nbrief",
                List.of(incident),
                CUTOFF,
                UUID.fromString("30000000-0000-0000-0000-000000000001"),
                false).get(1);
        var second = factory.create(
                secondHotel,
                LocalDate.of(2026, 7, 19),
                CUTOFF,
                "【SIMULATION｜DELIVERY_BLOCKED】\nbrief",
                List.of(incident),
                CUTOFF,
                UUID.fromString("30000000-0000-0000-0000-000000000002"),
                false).get(1);

        assertTrue(first.businessMessageKey().contains(
                firstHotel.hotelId().toString()));
        assertTrue(second.businessMessageKey().contains(
                secondHotel.hotelId().toString()));
        assertNotEquals(first.businessMessageKey(), second.businessMessageKey());
        assertNotEquals(first.eventId(), second.eventId());
    }

    @Test
    void allFourScenarioRunsAtSameCutoffKeepDistinctHourlyPreviewKeys() {
        var scope = new TenantHotelRef(
                TENANT_ID,
                UUID.fromString("20000000-0000-0000-0000-000000000001"));
        var factory = new SimulationOutboxFactory();

        var keys = java.util.Arrays.stream(SimulationScenarioCode.values())
                .map(scenario -> {
                    var runId = UUID.nameUUIDFromBytes(
                            ("scenario|" + scenario).getBytes(
                                    java.nio.charset.StandardCharsets.UTF_8));
                    return factory.create(
                            scope,
                            LocalDate.of(2026, 7, 19),
                            CUTOFF,
                            "【SIMULATION｜DELIVERY_BLOCKED】\nbrief",
                            List.of(),
                            CUTOFF,
                            runId,
                            scenario == SimulationScenarioCode.LATE_BRIEF_REPLAY)
                            .getFirst()
                            .businessMessageKey();
                })
                .collect(java.util.stream.Collectors.toSet());

        assertEquals(Set.copyOf(
                java.util.Arrays.asList(SimulationScenarioCode.values())).size(),
                keys.size());
        assertTrue(keys.stream().allMatch(
                key -> key.contains(":simulation:")));
    }
}
