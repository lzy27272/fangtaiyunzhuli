package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.InventoryItemKind;
import cn.sifangguan.ota.contracts.record.RoomNightStay;
import cn.sifangguan.ota.worker.simulation.domain.MetricState;
import cn.sifangguan.ota.worker.simulation.domain.MetricValue;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class JdbcSimulationPersistenceSemanticsTest {
    private static final LocalDate BUSINESS_DATE = LocalDate.of(2026, 7, 19);
    private static final Instant EVENT_AT = Instant.parse("2026-07-19T09:20:00Z");

    @Test
    void compositeBookingRevisionHashDoesNotCollapseDifferentOrdersWithR1() {
        var first = revision("ct-safe-a", "r1");
        var second = revision("ct-safe-b", "r1");

        assertNotEquals(
                JdbcSimulationJobRepository.bookingRevisionKeyHash(first),
                JdbcSimulationJobRepository.bookingRevisionKeyHash(second));
    }

    @Test
    void missingInventoryCountPersistsNullAndUnavailableRatherThanSoldOutZero() {
        var unknown = new InventoryAvailabilityRecord(
                "CT-UNKNOWN",
                "Unknown availability",
                InventoryItemKind.SELL_PRODUCT,
                Optional.empty(),
                EVENT_AT);

        assertNull(JdbcSimulationJobRepository.nullableSellableRoomCount(unknown));
        assertEquals(
                "UNAVAILABLE",
                JdbcSimulationJobRepository.inventoryItemQuality(unknown, true));
        assertEquals(
                "UNAVAILABLE",
                JdbcSimulationJobRepository.inventoryItemQuality(unknown, false));
        assertEquals(
                "AVAILABLE_UNKNOWN",
                JdbcSimulationJobRepository.inventoryItemReason(unknown, true));
        assertEquals(
                "MAPPING_AND_AVAILABLE_UNKNOWN",
                JdbcSimulationJobRepository.inventoryItemReason(unknown, false));
    }

    @Test
    void unavailableSourceOverridesRetainedInventoryEvidenceWithoutWritingZeroOrComplete() {
        var retainedEvidence = new InventoryAvailabilityRecord(
                "MT-RETAINED",
                "Retained evidence from failed collection",
                InventoryItemKind.SELL_PRODUCT,
                Optional.of(7),
                EVENT_AT);

        assertNull(JdbcSimulationJobRepository.nullableSellableRoomCount(
                retainedEvidence, false));
        assertEquals(
                "UNAVAILABLE",
                JdbcSimulationJobRepository.inventoryItemQuality(
                        retainedEvidence, true, false));
        assertEquals(
                "SOURCE_UNAVAILABLE",
                JdbcSimulationJobRepository.inventoryItemReason(
                        retainedEvidence, true, false));
    }

    @Test
    void metricQualityKeepsNotConfiguredDistinctAndPreservesConsistencyReason() {
        assertEquals(
                "NOT_CONFIGURED",
                JdbcSimulationJobRepository.metricQualityCode(
                        MetricState.NOT_CONFIGURED));
        assertEquals(
                "UNAVAILABLE",
                JdbcSimulationJobRepository.metricQualityCode(
                        MetricState.CONSISTENCY_ERROR));
        assertEquals(
                "SOURCE_VALUES_INCONSISTENT",
                JdbcSimulationJobRepository.metricReasonCode(
                        MetricValue.consistencyError(
                                "source values inconsistent")));
    }

    @Test
    void lateReplayRequiresAnAlreadyPublishedOriginalBrief() {
        assertThrows(
                IllegalStateException.class,
                () -> JdbcSimulationJobRepository.requireExistingBriefForReplay(
                        SimulationScenarioCode.LATE_BRIEF_REPLAY, false));
        JdbcSimulationJobRepository.requireExistingBriefForReplay(
                SimulationScenarioCode.LATE_BRIEF_REPLAY, true);
        JdbcSimulationJobRepository.requireExistingBriefForReplay(
                SimulationScenarioCode.BASELINE, false);
    }

    @Test
    void retryabilityBecomesTerminalAtTheConfiguredMaximumAttempt() {
        var retryableAttempt = claimedJob(2, 3);
        var finalAttempt = claimedJob(3, 3);

        assertEquals(true, retryableAttempt.willRetry(true));
        assertEquals(false, finalAttempt.willRetry(true));
        assertEquals(false, retryableAttempt.willRetry(false));
    }

    private static BookingRevisionRecord revision(
            String externalBookingId,
            String revisionKey) {
        return new BookingRevisionRecord(
                externalBookingId,
                revisionKey,
                EVENT_AT,
                BUSINESS_DATE,
                Map.of(),
                Map.of(new RoomNightStay("pool-standard", BUSINESS_DATE), 1),
                false,
                EVENT_AT);
    }

    private static ClaimedSimulationJob claimedJob(
            int attemptCount,
            int maxAttempts) {
        return new ClaimedSimulationJob(
                java.util.UUID.fromString(
                        "40000000-0000-0000-0000-000000000001"),
                java.util.UUID.fromString(
                        "40000000-0000-0000-0000-000000000002"),
                java.util.UUID.fromString(
                        "40000000-0000-0000-0000-000000000003"),
                java.util.UUID.fromString(
                        "40000000-0000-0000-0000-000000000004"),
                cn.sifangguan.ota.worker.simulation.fixture
                        .BuiltInSimulationFixture.DEFAULT_SCOPE,
                java.util.UUID.fromString(
                        "40000000-0000-0000-0000-000000000005"),
                "SIMULATION_PIPELINE",
                "SIMULATION_PIPELINE",
                "MANUAL_SIMULATION",
                cn.sifangguan.ota.worker.simulation.fixture
                        .BuiltInSimulationFixture.CUTOFF_AT,
                EVENT_AT.plusSeconds(600),
                attemptCount,
                maxAttempts,
                cn.sifangguan.ota.worker.simulation.fixture
                        .BuiltInSimulationFixture.FIXED_NOW,
                SimulationScenarioCode.BASELINE,
                cn.sifangguan.ota.worker.simulation.fixture
                        .BuiltInSimulationFixture.defaultConfiguration(),
                "Hotel");
    }
}
