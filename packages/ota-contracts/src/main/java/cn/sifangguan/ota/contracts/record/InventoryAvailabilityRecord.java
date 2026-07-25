package cn.sifangguan.ota.contracts.record;

import cn.sifangguan.ota.contracts.collection.StandardRecord;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

/**
 * One source inventory item. A missing available count is represented as empty,
 * never as zero. Explicitly closed/sold-out products are normalized to zero.
 */
public record InventoryAvailabilityRecord(
        String sourceInventoryId,
        String displayName,
        InventoryItemKind itemKind,
        Optional<Integer> effectiveAvailable,
        Instant sourceUpdatedAt) implements StandardRecord {

    public InventoryAvailabilityRecord {
        sourceInventoryId = requireText(sourceInventoryId, "sourceInventoryId");
        displayName = requireText(displayName, "displayName");
        Objects.requireNonNull(itemKind, "itemKind");
        effectiveAvailable = Objects.requireNonNull(effectiveAvailable, "effectiveAvailable");
        effectiveAvailable.ifPresent(value -> {
            if (value < 0) {
                throw new IllegalArgumentException("effectiveAvailable must not be negative");
            }
        });
        Objects.requireNonNull(sourceUpdatedAt, "sourceUpdatedAt");
    }

    @Override
    public String recordType() {
        return "inventory_availability.v1";
    }

    @Override
    public String sourceRecordKey() {
        return sourceInventoryId + ":" + sourceUpdatedAt;
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
