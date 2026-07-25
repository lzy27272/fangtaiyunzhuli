package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.RoomNightStay;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BookingDeltaCalculatorTest {
    private static final LocalDate DAY = LocalDate.of(2026, 7, 19);
    private static final Instant EVENT_AT = Instant.parse("2026-07-19T09:30:00Z");

    @Test
    void expandsMultisetModificationWithoutRoomIndex() {
        var today = new RoomNightStay("pool-a", DAY);
        var future = new RoomNightStay("pool-a", DAY.plusDays(1));
        var revision = new BookingRevisionRecord(
                "safe-order",
                "r2",
                EVENT_AT,
                DAY,
                Map.of(today, 2, future, 2),
                Map.of(today, 3, future, 1),
                false,
                EVENT_AT);

        var deltas = new BookingDeltaCalculator().expand(
                SourceSystem.CTRIP, java.util.List.of(revision));

        assertEquals(2, deltas.size());
        assertEquals(RoomNightDeltaReason.MODIFIED_ADD, deltas.get(0).reason());
        assertEquals(1, deltas.get(0).quantity());
        assertEquals(RoomNightDeltaReason.MODIFIED_REMOVE, deltas.get(1).reason());
        assertEquals(-1, deltas.get(1).quantity());
    }

    @Test
    void wholeCancellationKeepsDistinctCancellationReason() {
        var stay = new RoomNightStay("pool-a", DAY);
        var revision = new BookingRevisionRecord(
                "safe-order",
                "r3",
                EVENT_AT,
                DAY,
                Map.of(stay, 2),
                Map.of(),
                true,
                EVENT_AT);

        var delta = new BookingDeltaCalculator().expand(
                SourceSystem.MEITUAN, java.util.List.of(revision)).getFirst();

        assertEquals(-2, delta.quantity());
        assertEquals(RoomNightDeltaReason.CANCELLED, delta.reason());
    }
}
