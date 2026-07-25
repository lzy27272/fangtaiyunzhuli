package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public final class InventoryReconciliationService {
    public InventoryReconciliationResult reconcile(
            MappedInventorySnapshot snapshot,
            Map<SourceSystem, Boolean> sourceFresh,
            Duration maximumObservationSkew,
            Instant detectedAt) {
        Objects.requireNonNull(snapshot, "snapshot");
        sourceFresh = Map.copyOf(Objects.requireNonNull(sourceFresh, "sourceFresh"));
        Objects.requireNonNull(maximumObservationSkew, "maximumObservationSkew");
        Objects.requireNonNull(detectedAt, "detectedAt");
        if (maximumObservationSkew.isNegative()) {
            throw new IllegalArgumentException("maximumObservationSkew must not be negative");
        }

        var incidents = new ArrayList<InventoryIncident>();
        var reasons = new ArrayList<String>();
        for (var product : snapshot.products().stream()
                .sorted(Comparator
                        .comparing((ProductInventoryView value) -> value.channel().name())
                        .thenComparing(ProductInventoryView::otaProductId))
                .toList()) {
            if (!sourceFresh.getOrDefault(SourceSystem.PMS, false)
                    || !sourceFresh.getOrDefault(product.channel(), false)) {
                reasons.add("STALE:" + product.channel() + ":" + product.otaProductId());
                continue;
            }
            if (!product.mapped()) {
                reasons.add("MAPPING_MISSING:" + product.channel() + ":" + product.otaProductId());
                continue;
            }
            var skew = Duration.between(
                    product.pmsObservedAt(), product.otaObservedAt()).abs();
            if (skew.compareTo(maximumObservationSkew) > 0) {
                reasons.add("SNAPSHOT_NOT_ALIGNED:"
                        + product.channel() + ":" + product.otaProductId());
                continue;
            }
            if (product.pmsAvailable().isEmpty() || product.otaAvailable().isEmpty()) {
                reasons.add("AVAILABLE_UNKNOWN:"
                        + product.channel() + ":" + product.otaProductId());
                continue;
            }
            var pms = product.pmsAvailable().orElseThrow();
            var ota = product.otaAvailable().orElseThrow();
            var difference = ota - pms;
            if (difference == 0) {
                continue;
            }
            var direction = difference > 0
                    ? InventoryRiskDirection.OTA_MORE_THAN_PMS
                    : InventoryRiskDirection.OTA_LESS_THAN_PMS;
            var fingerprint = product.channel() + "|"
                    + product.otaProductId() + "|"
                    + product.inventoryPoolId().orElseThrow() + "|"
                    + direction;
            incidents.add(new InventoryIncident(
                    UUID.nameUUIDFromBytes(fingerprint.getBytes(StandardCharsets.UTF_8)),
                    product.channel(),
                    product.otaProductId(),
                    product.productName(),
                    product.inventoryPoolId().orElseThrow(),
                    product.physicalRoomTypeName().orElseThrow(),
                    pms,
                    ota,
                    difference,
                    direction,
                    detectedAt,
                    "OPEN_UNHANDLED"));
        }
        return new InventoryReconciliationResult(incidents, reasons);
    }
}
