package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.RoomNightStay;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

public record RoomNightDelta(
        SourceSystem channel,
        String externalBookingId,
        String revisionKey,
        Instant eventAt,
        LocalDate eventBusinessDate,
        RoomNightStay stay,
        int quantity,
        RoomNightDeltaReason reason) {

    public RoomNightDelta {
        Objects.requireNonNull(channel, "channel");
        if (channel != SourceSystem.CTRIP && channel != SourceSystem.MEITUAN) {
            throw new IllegalArgumentException("room-night channel must be CTRIP or MEITUAN");
        }
        externalBookingId = requireText(externalBookingId, "externalBookingId");
        revisionKey = requireText(revisionKey, "revisionKey");
        Objects.requireNonNull(eventAt, "eventAt");
        Objects.requireNonNull(eventBusinessDate, "eventBusinessDate");
        Objects.requireNonNull(stay, "stay");
        if (quantity == 0) {
            throw new IllegalArgumentException("room-night delta quantity must not be zero");
        }
        Objects.requireNonNull(reason, "reason");
        if ((reason == RoomNightDeltaReason.BOOKED
                || reason == RoomNightDeltaReason.MODIFIED_ADD) != (quantity > 0)) {
            throw new IllegalArgumentException("room-night delta reason and sign disagree");
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
