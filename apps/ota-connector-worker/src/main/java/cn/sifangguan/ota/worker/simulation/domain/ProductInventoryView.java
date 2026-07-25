package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;

public record ProductInventoryView(
        SourceSystem channel,
        String otaProductId,
        String productName,
        Optional<String> inventoryPoolId,
        Optional<String> physicalRoomTypeName,
        Optional<Integer> pmsAvailable,
        Optional<Integer> otaAvailable,
        Instant pmsObservedAt,
        Instant otaObservedAt,
        boolean mapped) {

    public ProductInventoryView {
        Objects.requireNonNull(channel, "channel");
        otaProductId = requireText(otaProductId, "otaProductId");
        productName = requireText(productName, "productName");
        inventoryPoolId = Objects.requireNonNull(inventoryPoolId, "inventoryPoolId");
        physicalRoomTypeName = Objects.requireNonNull(
                physicalRoomTypeName, "physicalRoomTypeName");
        pmsAvailable = Objects.requireNonNull(pmsAvailable, "pmsAvailable");
        otaAvailable = Objects.requireNonNull(otaAvailable, "otaAvailable");
        Objects.requireNonNull(pmsObservedAt, "pmsObservedAt");
        Objects.requireNonNull(otaObservedAt, "otaObservedAt");
        if (mapped != inventoryPoolId.isPresent()) {
            throw new IllegalArgumentException("mapped flag and inventoryPoolId disagree");
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
