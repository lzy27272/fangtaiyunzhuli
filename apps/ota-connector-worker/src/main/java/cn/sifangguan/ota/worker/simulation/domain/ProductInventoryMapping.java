package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.util.Objects;

public record ProductInventoryMapping(
        SourceSystem channel,
        String otaProductId,
        String inventoryPoolId,
        long version) {

    public ProductInventoryMapping {
        Objects.requireNonNull(channel, "channel");
        if (channel != SourceSystem.CTRIP && channel != SourceSystem.MEITUAN) {
            throw new IllegalArgumentException("mapping channel must be CTRIP or MEITUAN");
        }
        otaProductId = requireText(otaProductId, "otaProductId");
        inventoryPoolId = requireText(inventoryPoolId, "inventoryPoolId");
        if (version < 1) {
            throw new IllegalArgumentException("version must be positive");
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
