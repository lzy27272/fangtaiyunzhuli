package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.InventoryAvailabilityRecord;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import org.springframework.stereotype.Component;

import java.util.EnumMap;
import java.util.Map;
import java.util.Objects;

/**
 * Code-reviewed Sprint 2A schema allowlist. A connector cannot introduce a
 * standard-record class by returning it in the first successful collection.
 */
@Component
public final class ApprovedStandardRecordSchemaCatalog {
    private final Map<DataStreamType, Map<String, Class<? extends StandardRecord>>> byStream;

    public ApprovedStandardRecordSchemaCatalog() {
        var schemas = new EnumMap<
                DataStreamType,
                Map<String, Class<? extends StandardRecord>>>(DataStreamType.class);
        schemas.put(
                DataStreamType.BUSINESS_DATE,
                schema("pms_business_date.v1", PmsBusinessDateRecord.class));
        schemas.put(
                DataStreamType.BOOKING_EVENT,
                schema("booking_revision.v1", BookingRevisionRecord.class));
        schemas.put(
                DataStreamType.CANCELLATION_EVENT,
                schema("booking_revision.v1", BookingRevisionRecord.class));
        schemas.put(
                DataStreamType.INVENTORY_ROOM_TYPE,
                schema("inventory_availability.v1", InventoryAvailabilityRecord.class));
        schemas.put(
                DataStreamType.INVENTORY_SELL_PRODUCT,
                schema("inventory_availability.v1", InventoryAvailabilityRecord.class));
        schemas.put(
                DataStreamType.ROOM_REVENUE_DETAIL,
                schema("pms_operating_observation.v1", PmsOperatingRecord.class));
        schemas.put(
                DataStreamType.ROOM_REVENUE_AGGREGATE,
                schema("pms_operating_observation.v1", PmsOperatingRecord.class));
        schemas.put(
                DataStreamType.HOURLY_ROOM_REVENUE,
                schema("pms_operating_observation.v1", PmsOperatingRecord.class));
        schemas.put(
                DataStreamType.OVERNIGHT_SOLD,
                schema("pms_operating_observation.v1", PmsOperatingRecord.class));
        schemas.put(
                DataStreamType.EFFECTIVE_SELLABLE_TOTAL,
                schema("pms_operating_observation.v1", PmsOperatingRecord.class));
        byStream = Map.copyOf(schemas);
    }

    public Map<String, Class<? extends StandardRecord>> schemasFor(DataStreamType stream) {
        Objects.requireNonNull(stream, "stream");
        var approved = byStream.get(stream);
        if (approved == null) {
            throw new ConnectorContractDriftException(
                    ConnectorContractDriftReason.CONNECTOR_SCHEMA_DRIFT);
        }
        return approved;
    }

    private static Map<String, Class<? extends StandardRecord>> schema(
            String recordType,
            Class<? extends StandardRecord> recordClass) {
        return Map.of(recordType, recordClass);
    }
}
