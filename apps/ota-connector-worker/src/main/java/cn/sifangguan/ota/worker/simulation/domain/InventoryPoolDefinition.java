package cn.sifangguan.ota.worker.simulation.domain;

import java.util.Objects;

public record InventoryPoolDefinition(
        String inventoryPoolId,
        String pmsPhysicalRoomTypeId,
        String displayName) {

    public InventoryPoolDefinition {
        inventoryPoolId = requireText(inventoryPoolId, "inventoryPoolId");
        pmsPhysicalRoomTypeId = requireText(
                pmsPhysicalRoomTypeId, "pmsPhysicalRoomTypeId");
        displayName = requireText(displayName, "displayName");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
