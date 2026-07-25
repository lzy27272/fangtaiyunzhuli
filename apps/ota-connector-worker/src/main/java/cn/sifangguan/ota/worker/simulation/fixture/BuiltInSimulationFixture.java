package cn.sifangguan.ota.worker.simulation.fixture;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.InventoryItemKind;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import cn.sifangguan.ota.contracts.record.RoomNightStay;
import cn.sifangguan.ota.worker.simulation.domain.InventoryPoolDefinition;
import cn.sifangguan.ota.worker.simulation.domain.ProductInventoryMapping;
import cn.sifangguan.ota.worker.simulation.domain.RevenuePaceConfig;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationHotelConfiguration;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Safe, privacy-free Sprint 1 data. This fixture contains no endpoint, credential,
 * webhook, guest name, phone number or production hotel identifier.
 */
public final class BuiltInSimulationFixture {
    public static final TenantHotelRef DEFAULT_SCOPE = new TenantHotelRef(
            UUID.fromString("10000000-0000-0000-0000-000000000001"),
            UUID.fromString("20000000-0000-0000-0000-000000000001"));
    public static final LocalDate BUSINESS_DATE = LocalDate.of(2026, 7, 19);
    public static final Instant BUSINESS_DAY_STARTED_AT =
            Instant.parse("2026-07-18T19:00:00Z");
    public static final Instant CUTOFF_AT = Instant.parse("2026-07-19T10:00:00Z");
    public static final Instant FIXED_NOW = Instant.parse("2026-07-19T10:06:00Z");
    public static final ZoneId HOTEL_ZONE = ZoneId.of("Asia/Shanghai");
    public static final String HOTEL_NAME = "Sprint 1 模拟酒店";

    public static final String POOL_VIEW_TWIN = "pool-view-twin";
    public static final String POOL_LUX_KING = "pool-lux-king";
    public static final String POOL_ELEGANT_TWIN = "pool-elegant-twin";
    public static final String POOL_FAMILY = "pool-family";
    public static final String POOL_STANDARD = "pool-standard";

    private BuiltInSimulationFixture() {
    }

    public static List<InventoryPoolDefinition> inventoryPools() {
        return List.of(
                new InventoryPoolDefinition(
                        POOL_VIEW_TWIN, "PMS-VIEW-TWIN", "景观双床房"),
                new InventoryPoolDefinition(
                        POOL_LUX_KING, "PMS-LUX-KING", "轻奢大床房"),
                new InventoryPoolDefinition(
                        POOL_ELEGANT_TWIN, "PMS-ELEGANT-TWIN", "雅致双床房"),
                new InventoryPoolDefinition(
                        POOL_FAMILY, "PMS-FAMILY", "亲子主题房"),
                new InventoryPoolDefinition(
                        POOL_STANDARD, "PMS-STANDARD", "舒适大床房"));
    }

    public static List<ProductInventoryMapping> productMappings() {
        return List.of(
                new ProductInventoryMapping(
                        SourceSystem.CTRIP, "CT-VIEW-NO-BREAKFAST", POOL_VIEW_TWIN, 1),
                new ProductInventoryMapping(
                        SourceSystem.CTRIP, "CT-VIEW-BREAKFAST", POOL_VIEW_TWIN, 1),
                new ProductInventoryMapping(
                        SourceSystem.CTRIP, "CT-LUX-NO-BREAKFAST", POOL_LUX_KING, 1),
                new ProductInventoryMapping(
                        SourceSystem.CTRIP, "CT-STANDARD-NO-BREAKFAST", POOL_STANDARD, 1),
                new ProductInventoryMapping(
                        SourceSystem.MEITUAN, "MT-LUX-BREAKFAST", POOL_LUX_KING, 1),
                new ProductInventoryMapping(
                        SourceSystem.MEITUAN, "MT-STANDARD-NO-BREAKFAST", POOL_STANDARD, 1),
                new ProductInventoryMapping(
                        SourceSystem.MEITUAN, "MT-ELEGANT", POOL_ELEGANT_TWIN, 1));
    }

    public static RevenuePaceConfig revenueConfig() {
        return new RevenuePaceConfig(
                1,
                new BigDecimal("10000.0000"),
                new BigDecimal("200.0000"),
                new BigDecimal("0.882"),
                new BigDecimal("0.882"));
    }

    public static SimulationHotelConfiguration defaultConfiguration() {
        return new SimulationHotelConfiguration(
                HOTEL_ZONE,
                inventoryPools(),
                productMappings(),
                revenueConfig());
    }

    public static List<?> records(SourceSystem source, DataStreamType stream) {
        if (source == SourceSystem.PMS) {
            return pmsRecords(stream);
        }
        if (source == SourceSystem.CTRIP) {
            return otaRecords(stream, ctripInventory(), ctripBookings());
        }
        if (source == SourceSystem.MEITUAN) {
            return otaRecords(stream, meituanInventory(), meituanBookings());
        }
        return List.of();
    }

    private static List<?> pmsRecords(DataStreamType stream) {
        return switch (stream) {
            case BUSINESS_DATE -> List.of(new PmsBusinessDateRecord(
                    "pms-business-date-" + BUSINESS_DATE,
                    BUSINESS_DATE,
                    CUTOFF_AT));
            case ROOM_REVENUE_AGGREGATE -> List.of(
                    new PmsOperatingRecord(
                            "pms-operating-previous",
                            BUSINESS_DATE,
                            CUTOFF_AT.minusSeconds(3600),
                            new BigDecimal("7683.0000"),
                            new BigDecimal("50.0000"),
                            38,
                            12,
                            Optional.of(50),
                            CUTOFF_AT.minusSeconds(3600)),
                    new PmsOperatingRecord(
                            "pms-operating-current",
                            BUSINESS_DATE,
                            CUTOFF_AT,
                            new BigDecimal("7849.0000"),
                            new BigDecimal("50.0000"),
                            39,
                            11,
                            Optional.of(50),
                            CUTOFF_AT));
            case INVENTORY_ROOM_TYPE -> pmsInventory();
            default -> List.of();
        };
    }

    private static List<?> otaRecords(
            DataStreamType stream,
            List<InventoryAvailabilityRecord> inventory,
            List<BookingRevisionRecord> bookings) {
        return switch (stream) {
            case INVENTORY_SELL_PRODUCT -> inventory;
            case BOOKING_EVENT -> bookings;
            case CANCELLATION_EVENT -> bookings.stream()
                    .filter(record -> record.wholeOrderCancellation()
                            || record.afterRoomNights().size() < record.beforeRoomNights().size())
                    .toList();
            default -> List.of();
        };
    }

    private static List<InventoryAvailabilityRecord> pmsInventory() {
        return List.of(
                inventory("PMS-VIEW-TWIN", "景观双床房",
                        InventoryItemKind.PHYSICAL_ROOM_TYPE, 0),
                inventory("PMS-LUX-KING", "轻奢大床房",
                        InventoryItemKind.PHYSICAL_ROOM_TYPE, 0),
                inventory("PMS-ELEGANT-TWIN", "雅致双床房",
                        InventoryItemKind.PHYSICAL_ROOM_TYPE, 2),
                inventory("PMS-FAMILY", "亲子主题房",
                        InventoryItemKind.PHYSICAL_ROOM_TYPE, 1),
                inventory("PMS-STANDARD", "舒适大床房",
                        InventoryItemKind.PHYSICAL_ROOM_TYPE, 8));
    }

    private static List<InventoryAvailabilityRecord> ctripInventory() {
        return List.of(
                inventory("CT-VIEW-NO-BREAKFAST", "景观双床房（无早）",
                        InventoryItemKind.SELL_PRODUCT, 0),
                inventory("CT-VIEW-BREAKFAST", "景观双床房（含早）",
                        InventoryItemKind.SELL_PRODUCT, 0),
                inventory("CT-LUX-NO-BREAKFAST", "轻奢大床房（无早）",
                        InventoryItemKind.SELL_PRODUCT, 1),
                inventory("CT-STANDARD-NO-BREAKFAST", "舒适大床房（无早）",
                        InventoryItemKind.SELL_PRODUCT, 7));
    }

    private static List<InventoryAvailabilityRecord> meituanInventory() {
        return List.of(
                inventory("MT-LUX-BREAKFAST", "轻奢大床房（双早）",
                        InventoryItemKind.SELL_PRODUCT, 0),
                inventory("MT-STANDARD-NO-BREAKFAST", "舒适大床房（无早）",
                        InventoryItemKind.SELL_PRODUCT, 8),
                inventory("MT-ELEGANT", "雅致双床房",
                        InventoryItemKind.SELL_PRODUCT, 2));
    }

    private static InventoryAvailabilityRecord inventory(
            String id,
            String name,
            InventoryItemKind kind,
            int available) {
        return new InventoryAvailabilityRecord(
                id, name, kind, Optional.of(available), CUTOFF_AT);
    }

    private static List<BookingRevisionRecord> ctripBookings() {
        return List.of(
                booking("ct-safe-001", "r1", Instant.parse("2026-07-19T02:00:00Z"),
                        Map.of(), Map.of(stay(POOL_VIEW_TWIN, BUSINESS_DATE), 5), false),
                booking("ct-safe-002", "r1", Instant.parse("2026-07-19T03:00:00Z"),
                        Map.of(), Map.of(stay(POOL_STANDARD, BUSINESS_DATE.plusDays(1)), 4), false),
                booking("ct-safe-003", "r1", Instant.parse("2026-07-19T09:20:00Z"),
                        Map.of(), Map.of(stay(POOL_STANDARD, BUSINESS_DATE), 2), false),
                booking("ct-safe-004", "r2", Instant.parse("2026-07-19T09:35:00Z"),
                        Map.of(stay(POOL_FAMILY, BUSINESS_DATE.plusDays(1)), 2),
                        Map.of(stay(POOL_FAMILY, BUSINESS_DATE.plusDays(1)), 1), false),
                booking("ct-safe-005", "r2", Instant.parse("2026-07-19T09:50:00Z"),
                        Map.of(stay(POOL_ELEGANT_TWIN, BUSINESS_DATE), 1),
                        Map.of(), true));
    }

    private static List<BookingRevisionRecord> meituanBookings() {
        return List.of(
                booking("mt-safe-001", "r1", Instant.parse("2026-07-19T04:00:00Z"),
                        Map.of(), Map.of(stay(POOL_LUX_KING, BUSINESS_DATE), 3), false),
                booking("mt-safe-002", "r1", Instant.parse("2026-07-19T05:00:00Z"),
                        Map.of(), Map.of(stay(POOL_STANDARD, BUSINESS_DATE.plusDays(2)), 2), false),
                booking("mt-safe-003", "r1", Instant.parse("2026-07-19T09:10:00Z"),
                        Map.of(), Map.of(stay(POOL_STANDARD, BUSINESS_DATE), 1), false),
                booking("mt-safe-004", "r1", Instant.parse("2026-07-19T09:25:00Z"),
                        Map.of(), Map.of(stay(POOL_FAMILY, BUSINESS_DATE.plusDays(1)), 2), false),
                booking("mt-safe-005", "r2", Instant.parse("2026-07-19T09:45:00Z"),
                        Map.of(stay(POOL_ELEGANT_TWIN, BUSINESS_DATE), 2),
                        Map.of(stay(POOL_ELEGANT_TWIN, BUSINESS_DATE), 1), false));
    }

    private static RoomNightStay stay(String pool, LocalDate date) {
        return new RoomNightStay(pool, date);
    }

    private static BookingRevisionRecord booking(
            String bookingId,
            String revision,
            Instant eventAt,
            Map<RoomNightStay, Integer> before,
            Map<RoomNightStay, Integer> after,
            boolean wholeCancellation) {
        return new BookingRevisionRecord(
                bookingId,
                revision,
                eventAt,
                BUSINESS_DATE,
                before,
                after,
                wholeCancellation,
                eventAt);
    }
}
