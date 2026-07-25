package cn.sifangguan.ota.api.sprint1.domain;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class Sprint1Views {
    private Sprint1Views() {
    }

    public record Envelope<T>(T data) {
    }

    public record TenantView(
            UUID tenantId,
            String tenantCode,
            String displayName,
            String timezone,
            String status,
            long rowVersion
    ) {
    }

    public record HotelView(
            UUID tenantId,
            UUID hotelId,
            String hotelCode,
            String displayName,
            String timezone,
            String lifecycleStatus,
            boolean collectionEnabled,
            boolean messageEnabled,
            long rowVersion
    ) {
    }

    /**
     * Deliberately contains no SecretStore reference or secret value. A caller
     * can see only whether a binding exists and a non-reversible fingerprint.
     */
    public record SecretReferenceStatus(
            boolean referenceConfigured,
            String referenceFingerprint,
            String authorizationStatus,
            Instant lastCheckedAt
    ) {
    }

    public record ConnectorView(
            UUID connectorId,
            String adapterCode,
            String sourceCode,
            boolean enabled,
            String fixtureScenarioCode,
            int pollIntervalMinutes,
            long rowVersion,
            SecretReferenceStatus secret
    ) {
    }

    public record InventoryPoolView(
            UUID inventoryPoolId,
            String physicalRoomTypeCode,
            String displayName,
            int physicalRoomCount,
            long rowVersion
    ) {
    }

    public record SellableProductView(
            UUID productId,
            UUID connectorId,
            String sourceCode,
            String externalProductCode,
            String displayName,
            String mealPlanCode,
            long rowVersion
    ) {
    }

    public record ProductMappingView(
            UUID mappingVersionId,
            UUID productId,
            UUID inventoryPoolId,
            Instant validFrom,
            Instant validUntil,
            long rowVersion
    ) {
    }

    public record RevenueTargetView(
            UUID targetVersionId,
            LocalDate businessDate,
            BigDecimal roomRevenueTarget,
            BigDecimal targetAdr,
            long rowVersion
    ) {
    }

    public record PacePoint(
            LocalTime cutoffLocalTime,
            BigDecimal revenueProgressPercent,
            BigDecimal soldProgressPercent
    ) {
    }

    public record PaceCurveView(
            UUID paceCurveVersionId,
            String curveCode,
            LocalDate validFrom,
            LocalDate validUntil,
            List<PacePoint> points,
            long rowVersion
    ) {
        public PaceCurveView {
            points = List.copyOf(points);
        }
    }

    public record ConfigurationView(
            TenantView tenant,
            HotelView hotel,
            List<ConnectorView> connectors,
            List<InventoryPoolView> inventoryPools,
            List<SellableProductView> products,
            List<ProductMappingView> productMappings,
            List<RevenueTargetView> targets,
            List<PaceCurveView> paceCurves,
            boolean simulationMode,
            boolean outboundDeliveryBlocked
    ) {
        public ConfigurationView {
            connectors = List.copyOf(connectors);
            inventoryPools = List.copyOf(inventoryPools);
            products = List.copyOf(products);
            productMappings = List.copyOf(productMappings);
            targets = List.copyOf(targets);
            paceCurves = List.copyOf(paceCurves);
        }
    }

    public record SourceFreshnessView(
            String sourceCode,
            String completeness,
            Instant sourceObservedAt,
            Instant ingestedAt
    ) {
    }

    public record MetricValue(
            BigDecimal value,
            String unit,
            String state
    ) {
    }

    public record InventoryView(
            UUID inventoryPoolId,
            String physicalRoomTypeCode,
            String displayName,
            Integer pmsAvailableRooms,
            Map<String, Integer> otaAvailableRooms,
            String state
    ) {
        public InventoryView {
            otaAvailableRooms = Map.copyOf(otaAvailableRooms);
        }
    }

    public record MonitorView(
            UUID tenantId,
            UUID hotelId,
            String hotelName,
            LocalDate businessDate,
            Instant cutoffAt,
            String completeness,
            boolean simulationMode,
            List<SourceFreshnessView> sources,
            Map<String, MetricValue> metrics,
            List<InventoryView> inventory
    ) {
        public MonitorView {
            sources = List.copyOf(sources);
            metrics = Map.copyOf(metrics);
            inventory = List.copyOf(inventory);
        }
    }

    public record BriefView(
            UUID briefId,
            LocalDate businessDate,
            Instant cutoffAt,
            int revisionNo,
            String completenessCode,
            String content,
            Instant publishedAt,
            UUID simulationRunId,
            String deliveryStatus,
            boolean simulationMode
    ) {
    }

    public record IncidentView(
            UUID incidentId,
            String type,
            String status,
            String sourceCode,
            String directionCode,
            Instant openedAt,
            Instant lastObservedAt,
            UUID taskId,
            long rowVersion
    ) {
    }

    public record OutboxPreview(
            UUID eventId,
            String messageKey,
            String messageType,
            Instant createdAt,
            boolean deliveryBlocked,
            String deliveryStatus,
            String bodyPreview
    ) {
    }

    public record SimulationRunView(
            UUID runId,
            String scenarioCode,
            String status,
            Instant fixedClockAt,
            Instant scheduledFor,
            Instant startedAt,
            Instant completedAt,
            UUID briefId,
            List<UUID> incidentIds,
            long rowVersion
    ) {
        public SimulationRunView {
            incidentIds = List.copyOf(incidentIds);
        }
    }

    public record SimulationHotelView(
            UUID tenantId,
            UUID hotelId,
            String tenantCode,
            String tenantName,
            String hotelCode,
            String hotelName,
            String timezone,
            String lifecycleStatus,
            boolean collectionEnabled,
            boolean messageEnabled,
            int configuredMockConnectors,
            boolean simulationOnly,
            long rowVersion
    ) {
    }

    public record SimulationHotelDirectoryView(
            String coverage,
            List<SimulationHotelView> hotels,
            List<UUID> failedTenantIds
    ) {
        public SimulationHotelDirectoryView {
            hotels = List.copyOf(hotels);
            failedTenantIds = List.copyOf(failedTenantIds);
        }
    }

    public record CommandReceipt(
            String commandId,
            UUID resourceId,
            long resultingRowVersion,
            boolean replayed
    ) {
    }
}
