package cn.sifangguan.ota.worker.simulation.domain;

import java.util.List;
import java.util.Objects;

public record InventoryReconciliationResult(
        List<InventoryIncident> incidents,
        List<String> notComparableReasons) {

    public InventoryReconciliationResult {
        incidents = List.copyOf(Objects.requireNonNull(incidents, "incidents"));
        notComparableReasons = List.copyOf(
                Objects.requireNonNull(notComparableReasons, "notComparableReasons"));
    }
}
