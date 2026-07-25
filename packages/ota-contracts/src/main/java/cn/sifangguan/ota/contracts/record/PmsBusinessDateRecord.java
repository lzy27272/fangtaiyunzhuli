package cn.sifangguan.ota.contracts.record;

import cn.sifangguan.ota.contracts.collection.StandardRecord;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

public record PmsBusinessDateRecord(
        String observationKey,
        LocalDate businessDate,
        Instant sourceUpdatedAt) implements StandardRecord {

    public PmsBusinessDateRecord {
        observationKey = requireText(observationKey, "observationKey");
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(sourceUpdatedAt, "sourceUpdatedAt");
    }

    @Override
    public String recordType() {
        return "pms_business_date.v1";
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
