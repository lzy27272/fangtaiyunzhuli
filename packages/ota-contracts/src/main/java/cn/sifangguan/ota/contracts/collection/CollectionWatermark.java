package cn.sifangguan.ota.contracts.collection;

import java.time.Instant;
import java.util.Objects;

public record CollectionWatermark(String type, String opaqueValue, Instant sourceUpdatedAt) {
    public CollectionWatermark {
        type = requireText(type, "type");
        opaqueValue = requireText(opaqueValue, "opaqueValue");
        Objects.requireNonNull(sourceUpdatedAt, "sourceUpdatedAt");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
