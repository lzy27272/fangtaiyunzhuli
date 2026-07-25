package cn.sifangguan.ota.worker.fixture;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWindow;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public final class CollectionFixtures {
    public static final Instant NOW = Instant.parse("2026-07-23T10:00:00Z");

    private CollectionFixtures() {
    }

    public static CollectionRequest request() {
        return new CollectionRequest(
                new TenantHotelRef(UUID.randomUUID(), UUID.randomUUID()),
                UUID.randomUUID(),
                1,
                UUID.randomUUID(),
                DataStreamType.BOOKING_EVENT,
                CollectionTrigger.SCHEDULED,
                new CollectionWindow(NOW.minus(Duration.ofMinutes(15)), NOW),
                Optional.empty(),
                Optional.empty(),
                NOW,
                Duration.ofMinutes(2),
                new TraceContext("trace-test", "correlation-test"));
    }

    public static CollectionResult success() {
        return new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-20260723T100000Z",
                        NOW)),
                Optional.of(NOW),
                NOW,
                List.of(),
                new CollectionQuality(
                        DataQualityState.FRESH,
                        CompletenessState.COMPLETE,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        List.of()),
                Optional.empty());
    }
}
