package cn.sifangguan.ota.contracts.record;

import cn.sifangguan.ota.contracts.collection.StandardRecord;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;
import java.util.Optional;

/**
 * PMS operating facts at one observation point. Revenue is room revenue only and
 * {@code totalRoomRevenue} includes hourly-room revenue.
 */
public record PmsOperatingRecord(
        String observationKey,
        LocalDate businessDate,
        Instant asOf,
        BigDecimal totalRoomRevenue,
        BigDecimal hourlyRoomRevenue,
        int overnightSold,
        int currentAvailable,
        Optional<Integer> effectiveSellableTotal,
        Instant sourceUpdatedAt) implements StandardRecord {

    public PmsOperatingRecord {
        observationKey = requireText(observationKey, "observationKey");
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(asOf, "asOf");
        Objects.requireNonNull(totalRoomRevenue, "totalRoomRevenue");
        Objects.requireNonNull(hourlyRoomRevenue, "hourlyRoomRevenue");
        effectiveSellableTotal = Objects.requireNonNull(
                effectiveSellableTotal, "effectiveSellableTotal");
        Objects.requireNonNull(sourceUpdatedAt, "sourceUpdatedAt");
        effectiveSellableTotal.ifPresent(value -> {
            if (value < 0) {
                throw new IllegalArgumentException(
                        "effectiveSellableTotal must not be negative when present");
            }
        });
    }

    @Override
    public String recordType() {
        return "pms_operating_observation.v1";
    }

    @Override
    public String sourceRecordKey() {
        return observationKey;
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
