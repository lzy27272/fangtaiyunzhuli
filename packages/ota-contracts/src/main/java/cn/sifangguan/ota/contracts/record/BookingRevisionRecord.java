package cn.sifangguan.ota.contracts.record;

import cn.sifangguan.ota.contracts.collection.StandardRecord;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;

/**
 * A privacy-minimized immutable order revision represented by its before/after
 * room-night multisets. Guest names, phones and other PII are deliberately absent.
 */
public record BookingRevisionRecord(
        String externalBookingId,
        String revisionKey,
        Instant eventAt,
        LocalDate eventBusinessDate,
        Map<RoomNightStay, Integer> beforeRoomNights,
        Map<RoomNightStay, Integer> afterRoomNights,
        boolean wholeOrderCancellation,
        Instant sourceUpdatedAt) implements StandardRecord {

    public BookingRevisionRecord {
        externalBookingId = requireText(externalBookingId, "externalBookingId");
        revisionKey = requireText(revisionKey, "revisionKey");
        Objects.requireNonNull(eventAt, "eventAt");
        Objects.requireNonNull(eventBusinessDate, "eventBusinessDate");
        beforeRoomNights = immutableMultiset(beforeRoomNights, "beforeRoomNights");
        afterRoomNights = immutableMultiset(afterRoomNights, "afterRoomNights");
        Objects.requireNonNull(sourceUpdatedAt, "sourceUpdatedAt");
        if (wholeOrderCancellation && !afterRoomNights.isEmpty()) {
            throw new IllegalArgumentException(
                    "wholeOrderCancellation requires an empty afterRoomNights multiset");
        }
        if (beforeRoomNights.equals(afterRoomNights)) {
            throw new IllegalArgumentException(
                    "booking revision must change at least one room-night quantity");
        }
    }

    @Override
    public String recordType() {
        return "booking_revision.v1";
    }

    @Override
    public String sourceRecordKey() {
        return externalBookingId + ":" + revisionKey;
    }

    private static Map<RoomNightStay, Integer> immutableMultiset(
            Map<RoomNightStay, Integer> values,
            String field) {
        Objects.requireNonNull(values, field);
        var sorted = new TreeMap<RoomNightStay, Integer>();
        values.forEach((stay, quantity) -> {
            Objects.requireNonNull(stay, field + " key");
            Objects.requireNonNull(quantity, field + " quantity");
            if (quantity <= 0) {
                throw new IllegalArgumentException(field + " quantities must be positive");
            }
            sorted.put(stay, quantity);
        });
        return Collections.unmodifiableMap(new LinkedHashMap<>(sorted));
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
