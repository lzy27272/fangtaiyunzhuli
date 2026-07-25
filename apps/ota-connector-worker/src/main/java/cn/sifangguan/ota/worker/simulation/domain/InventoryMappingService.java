package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.InventoryItemKind;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

public final class InventoryMappingService {
    public MappedInventorySnapshot map(
            List<InventoryPoolDefinition> pools,
            List<ProductInventoryMapping> mappings,
            List<StandardRecordEnvelope<InventoryAvailabilityRecord>> pmsRecords,
            List<StandardRecordEnvelope<InventoryAvailabilityRecord>> otaRecords) {
        Objects.requireNonNull(pools, "pools");
        Objects.requireNonNull(mappings, "mappings");
        Objects.requireNonNull(pmsRecords, "pmsRecords");
        Objects.requireNonNull(otaRecords, "otaRecords");

        var poolByPhysicalId = pools.stream().collect(Collectors.toMap(
                InventoryPoolDefinition::pmsPhysicalRoomTypeId,
                Function.identity(),
                (left, right) -> {
                    throw new IllegalArgumentException(
                            "duplicate PMS physical room type mapping: "
                                    + left.pmsPhysicalRoomTypeId());
                },
                LinkedHashMap::new));
        var poolById = pools.stream().collect(Collectors.toMap(
                InventoryPoolDefinition::inventoryPoolId,
                Function.identity(),
                (left, right) -> {
                    throw new IllegalArgumentException(
                            "duplicate inventory pool: " + left.inventoryPoolId());
                },
                LinkedHashMap::new));
        var mappingByProduct = mappings.stream().collect(Collectors.toMap(
                mapping -> key(mapping.channel(), mapping.otaProductId()),
                Function.identity(),
                (left, right) -> {
                    throw new IllegalArgumentException(
                            "duplicate OTA product mapping: " + left.otaProductId());
                },
                LinkedHashMap::new));

        var physicalAvailable = new LinkedHashMap<String, Optional<Integer>>();
        var physicalNames = new LinkedHashMap<String, String>();
        var issues = new ArrayList<String>();
        for (var envelope : pmsRecords.stream()
                .sorted(Comparator.comparing(item -> item.record().sourceInventoryId()))
                .toList()) {
            var record = envelope.record();
            if (envelope.sourceSystem() != SourceSystem.PMS
                    || record.itemKind() != InventoryItemKind.PHYSICAL_ROOM_TYPE) {
                issues.add("INVALID_PMS_INVENTORY_KIND:" + record.sourceInventoryId());
                continue;
            }
            var pool = poolByPhysicalId.get(record.sourceInventoryId());
            if (pool == null) {
                issues.add("PMS_ROOM_TYPE_MAPPING_MISSING:" + record.sourceInventoryId());
                continue;
            }
            if (physicalAvailable.putIfAbsent(
                    pool.inventoryPoolId(), record.effectiveAvailable()) != null) {
                issues.add("DUPLICATE_PMS_ROOM_TYPE:" + record.sourceInventoryId());
                continue;
            }
            physicalNames.put(pool.inventoryPoolId(), pool.displayName());
        }

        var products = new ArrayList<ProductInventoryView>();
        for (var envelope : otaRecords.stream()
                .sorted(Comparator
                        .comparing((StandardRecordEnvelope<InventoryAvailabilityRecord> item) ->
                                item.sourceSystem().name())
                        .thenComparing(item -> item.record().sourceInventoryId()))
                .toList()) {
            var record = envelope.record();
            if ((envelope.sourceSystem() != SourceSystem.CTRIP
                    && envelope.sourceSystem() != SourceSystem.MEITUAN)
                    || record.itemKind() != InventoryItemKind.SELL_PRODUCT) {
                issues.add("INVALID_OTA_INVENTORY_KIND:" + record.sourceInventoryId());
                continue;
            }
            var mapping = mappingByProduct.get(
                    key(envelope.sourceSystem(), record.sourceInventoryId()));
            if (mapping == null) {
                issues.add("OTA_PRODUCT_MAPPING_MISSING:"
                        + envelope.sourceSystem() + ":" + record.sourceInventoryId());
                products.add(new ProductInventoryView(
                        envelope.sourceSystem(),
                        record.sourceInventoryId(),
                        record.displayName(),
                        Optional.empty(),
                        Optional.empty(),
                        Optional.empty(),
                        record.effectiveAvailable(),
                        pmsObservedAtOrFallback(pmsRecords, envelope.observedAt()),
                        envelope.observedAt(),
                        false));
                continue;
            }
            var pool = poolById.get(mapping.inventoryPoolId());
            if (pool == null) {
                issues.add("INVENTORY_POOL_MISSING:" + mapping.inventoryPoolId());
                products.add(new ProductInventoryView(
                        envelope.sourceSystem(),
                        record.sourceInventoryId(),
                        record.displayName(),
                        Optional.empty(),
                        Optional.empty(),
                        Optional.empty(),
                        record.effectiveAvailable(),
                        pmsObservedAtOrFallback(pmsRecords, envelope.observedAt()),
                        envelope.observedAt(),
                        false));
                continue;
            }
            products.add(new ProductInventoryView(
                    envelope.sourceSystem(),
                    record.sourceInventoryId(),
                    record.displayName(),
                    Optional.of(pool.inventoryPoolId()),
                    Optional.of(pool.displayName()),
                    physicalAvailable.getOrDefault(pool.inventoryPoolId(), Optional.empty()),
                    record.effectiveAvailable(),
                    pmsObservedAtOrFallback(pmsRecords, envelope.observedAt()),
                    envelope.observedAt(),
                    true));
        }

        var soldOut = physicalAvailable.entrySet().stream()
                .filter(entry -> entry.getValue().isPresent()
                        && entry.getValue().orElseThrow() == 0)
                .map(entry -> physicalNames.get(entry.getKey()))
                .filter(Objects::nonNull)
                .sorted()
                .toList();

        return new MappedInventorySnapshot(
                physicalAvailable,
                physicalNames,
                products,
                soldOut,
                issues);
    }

    private static java.time.Instant pmsObservedAtOrFallback(
            List<StandardRecordEnvelope<InventoryAvailabilityRecord>> pmsRecords,
            java.time.Instant fallback) {
        return pmsRecords.stream()
                .map(StandardRecordEnvelope::observedAt)
                .max(Comparator.naturalOrder())
                .orElse(fallback);
    }

    private static String key(SourceSystem channel, String productId) {
        return channel.name() + ":" + productId;
    }
}
