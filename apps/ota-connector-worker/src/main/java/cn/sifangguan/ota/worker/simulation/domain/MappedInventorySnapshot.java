package cn.sifangguan.ota.worker.simulation.domain;

import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

public record MappedInventorySnapshot(
        Map<String, Optional<Integer>> physicalAvailableByPool,
        Map<String, String> physicalNameByPool,
        List<ProductInventoryView> products,
        List<String> soldOutPhysicalRoomTypes,
        List<String> mappingIssues) {

    public MappedInventorySnapshot {
        physicalAvailableByPool = Map.copyOf(
                Objects.requireNonNull(physicalAvailableByPool, "physicalAvailableByPool"));
        physicalNameByPool = Map.copyOf(
                Objects.requireNonNull(physicalNameByPool, "physicalNameByPool"));
        products = List.copyOf(Objects.requireNonNull(products, "products"));
        soldOutPhysicalRoomTypes = List.copyOf(
                Objects.requireNonNull(soldOutPhysicalRoomTypes, "soldOutPhysicalRoomTypes"));
        mappingIssues = List.copyOf(Objects.requireNonNull(mappingIssues, "mappingIssues"));
    }
}
