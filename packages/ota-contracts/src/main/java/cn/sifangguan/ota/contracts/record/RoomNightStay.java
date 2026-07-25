package cn.sifangguan.ota.contracts.record;

import java.time.LocalDate;
import java.util.Objects;

public record RoomNightStay(String inventoryPoolId, LocalDate stayDate)
        implements Comparable<RoomNightStay> {

    public RoomNightStay {
        inventoryPoolId = requireText(inventoryPoolId, "inventoryPoolId");
        Objects.requireNonNull(stayDate, "stayDate");
    }

    @Override
    public int compareTo(RoomNightStay other) {
        var byPool = inventoryPoolId.compareTo(other.inventoryPoolId);
        return byPool != 0 ? byPool : stayDate.compareTo(other.stayDate);
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
