package cn.sifangguan.ota.worker.simulation.pipeline;

import cn.sifangguan.ota.worker.simulation.domain.InventoryPoolDefinition;
import cn.sifangguan.ota.worker.simulation.domain.ProductInventoryMapping;
import cn.sifangguan.ota.worker.simulation.domain.RevenuePaceConfig;

import java.time.ZoneId;
import java.util.List;
import java.util.Objects;

public record SimulationHotelConfiguration(
        ZoneId hotelZone,
        List<InventoryPoolDefinition> inventoryPools,
        List<ProductInventoryMapping> productMappings,
        RevenuePaceConfig revenuePace) {

    public SimulationHotelConfiguration {
        Objects.requireNonNull(hotelZone, "hotelZone");
        inventoryPools = List.copyOf(
                Objects.requireNonNull(inventoryPools, "inventoryPools"));
        productMappings = List.copyOf(
                Objects.requireNonNull(productMappings, "productMappings"));
        Objects.requireNonNull(revenuePace, "revenuePace");
        if (inventoryPools.isEmpty()) {
            throw new IllegalArgumentException("inventoryPools must not be empty");
        }
        if (productMappings.isEmpty()) {
            throw new IllegalArgumentException("productMappings must not be empty");
        }
    }
}
