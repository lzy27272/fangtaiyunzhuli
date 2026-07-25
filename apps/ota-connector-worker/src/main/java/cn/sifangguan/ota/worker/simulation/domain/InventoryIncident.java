package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record InventoryIncident(
        UUID incidentId,
        SourceSystem channel,
        String otaProductId,
        String productName,
        String inventoryPoolId,
        String physicalRoomTypeName,
        int pmsAvailable,
        int otaAvailable,
        int difference,
        InventoryRiskDirection direction,
        Instant detectedAt,
        String status) {

    public InventoryIncident {
        Objects.requireNonNull(incidentId, "incidentId");
        Objects.requireNonNull(channel, "channel");
        otaProductId = requireText(otaProductId, "otaProductId");
        productName = requireText(productName, "productName");
        inventoryPoolId = requireText(inventoryPoolId, "inventoryPoolId");
        physicalRoomTypeName = requireText(physicalRoomTypeName, "physicalRoomTypeName");
        if (difference == 0 || difference != otaAvailable - pmsAvailable) {
            throw new IllegalArgumentException("difference must be otaAvailable - pmsAvailable");
        }
        Objects.requireNonNull(direction, "direction");
        Objects.requireNonNull(detectedAt, "detectedAt");
        status = requireText(status, "status");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
