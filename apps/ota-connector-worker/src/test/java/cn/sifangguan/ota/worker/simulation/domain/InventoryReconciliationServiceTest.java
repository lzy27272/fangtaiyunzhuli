package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InventoryReconciliationServiceTest {
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-19T10:00:30Z");

    @Test
    void sharedProductsAreComparedIndividuallyAndNeverSummed() {
        var snapshot = new MappedInventorySnapshot(
                Map.of("pool-a", Optional.of(2)),
                Map.of("pool-a", "景观双床房"),
                List.of(
                        product("P-WITH", 2),
                        product("P-WITHOUT", 1)),
                List.of(),
                List.of());

        var result = new InventoryReconciliationService().reconcile(
                snapshot,
                Map.of(
                        SourceSystem.PMS, true,
                        SourceSystem.CTRIP, true),
                Duration.ofMinutes(2),
                OBSERVED_AT.plusSeconds(30));

        assertEquals(1, result.incidents().size());
        assertEquals("P-WITHOUT", result.incidents().getFirst().otaProductId());
        assertEquals(-1, result.incidents().getFirst().difference());
        assertEquals(InventoryRiskDirection.OTA_LESS_THAN_PMS,
                result.incidents().getFirst().direction());
    }

    @Test
    void staleSourceFailsClosedWithoutP1() {
        var snapshot = new MappedInventorySnapshot(
                Map.of("pool-a", Optional.of(2)),
                Map.of("pool-a", "景观双床房"),
                List.of(product("P-WITH", 9)),
                List.of(),
                List.of());

        var result = new InventoryReconciliationService().reconcile(
                snapshot,
                Map.of(
                        SourceSystem.PMS, true,
                        SourceSystem.CTRIP, false),
                Duration.ofMinutes(2),
                OBSERVED_AT.plusSeconds(30));

        assertTrue(result.incidents().isEmpty());
        assertEquals(List.of("STALE:CTRIP:P-WITH"), result.notComparableReasons());
    }

    @Test
    void misalignedSnapshotFailsClosedWithoutP1() {
        var product = new ProductInventoryView(
                SourceSystem.CTRIP,
                "P-WITH",
                "含早",
                Optional.of("pool-a"),
                Optional.of("景观双床房"),
                Optional.of(2),
                Optional.of(9),
                OBSERVED_AT,
                OBSERVED_AT.plusSeconds(121),
                true);
        var snapshot = new MappedInventorySnapshot(
                Map.of("pool-a", Optional.of(2)),
                Map.of("pool-a", "景观双床房"),
                List.of(product),
                List.of(),
                List.of());

        var result = new InventoryReconciliationService().reconcile(
                snapshot,
                Map.of(
                        SourceSystem.PMS, true,
                        SourceSystem.CTRIP, true),
                Duration.ofMinutes(2),
                OBSERVED_AT.plusSeconds(130));

        assertTrue(result.incidents().isEmpty());
        assertEquals(List.of("SNAPSHOT_NOT_ALIGNED:CTRIP:P-WITH"),
                result.notComparableReasons());
    }

    private static ProductInventoryView product(String productId, int available) {
        return new ProductInventoryView(
                SourceSystem.CTRIP,
                productId,
                productId,
                Optional.of("pool-a"),
                Optional.of("景观双床房"),
                Optional.of(2),
                Optional.of(available),
                OBSERVED_AT,
                OBSERVED_AT.plusSeconds(30),
                true);
    }
}
