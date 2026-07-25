package cn.sifangguan.ota.contracts.record;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NormalizedRecordContractTest {
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-19T10:00:30Z");
    private static final LocalDate BUSINESS_DATE = LocalDate.of(2026, 7, 19);

    @Test
    void missingInventoryIsDifferentFromExplicitZero() {
        var missing = new InventoryAvailabilityRecord(
                "P-1", "无早", InventoryItemKind.SELL_PRODUCT, Optional.empty(), OBSERVED_AT);
        var soldOut = new InventoryAvailabilityRecord(
                "P-2", "含早", InventoryItemKind.SELL_PRODUCT, Optional.of(0), OBSERVED_AT);

        assertEquals(Optional.empty(), missing.effectiveAvailable());
        assertEquals(Optional.of(0), soldOut.effectiveAvailable());
    }

    @Test
    void bookingRevisionCopiesAndOrdersMultisets() {
        var later = new RoomNightStay("pool-b", BUSINESS_DATE.plusDays(1));
        var earlier = new RoomNightStay("pool-a", BUSINESS_DATE);
        var revision = new BookingRevisionRecord(
                "safe-order-1",
                "r1",
                OBSERVED_AT,
                BUSINESS_DATE,
                Map.of(later, 1, earlier, 2),
                Map.of(earlier, 1),
                false,
                OBSERVED_AT);

        assertEquals(java.util.List.of(earlier, later),
                revision.beforeRoomNights().keySet().stream().toList());
        assertThrows(UnsupportedOperationException.class,
                () -> revision.beforeRoomNights().put(earlier, 9));
    }

    @Test
    void wholeOrderCancellationCannotRetainRoomNights() {
        var stay = new RoomNightStay("pool-a", BUSINESS_DATE);
        assertThrows(IllegalArgumentException.class, () -> new BookingRevisionRecord(
                "safe-order-1",
                "r2",
                OBSERVED_AT,
                BUSINESS_DATE,
                Map.of(stay, 1),
                Map.of(stay, 1),
                true,
                OBSERVED_AT));
    }

    @Test
    void operatingFactsKeepDecimalValuesUnrounded() {
        var record = new PmsOperatingRecord(
                "current",
                BUSINESS_DATE,
                OBSERVED_AT,
                new BigDecimal("7849.1234"),
                new BigDecimal("50.1234"),
                39,
                11,
                Optional.of(50),
                OBSERVED_AT);

        assertEquals(new BigDecimal("7849.1234"), record.totalRoomRevenue());
    }
}
