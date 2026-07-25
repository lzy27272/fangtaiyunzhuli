package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.CollectionTrigger;
import cn.sifangguan.ota.contracts.connector.DataStreamType;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record CollectionRequest(
        TenantHotelRef scope,
        UUID connectorId,
        long configVersion,
        UUID runId,
        DataStreamType stream,
        CollectionTrigger trigger,
        CollectionWindow window,
        Optional<CollectionWatermark> committedWatermark,
        Optional<PmsBusinessDayContext> businessDayContext,
        Instant cutoffAt,
        Duration timeout,
        TraceContext traceContext) {

    public CollectionRequest {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(connectorId, "connectorId");
        if (configVersion < 1) {
            throw new IllegalArgumentException("configVersion must be positive");
        }
        Objects.requireNonNull(runId, "runId");
        Objects.requireNonNull(stream, "stream");
        Objects.requireNonNull(trigger, "trigger");
        Objects.requireNonNull(window, "window");
        committedWatermark = Objects.requireNonNull(committedWatermark, "committedWatermark");
        businessDayContext = Objects.requireNonNull(businessDayContext, "businessDayContext");
        Objects.requireNonNull(cutoffAt, "cutoffAt");
        if (cutoffAt.isBefore(window.toInclusive())) {
            throw new IllegalArgumentException("cutoffAt must not precede window.toInclusive");
        }
        Objects.requireNonNull(timeout, "timeout");
        if (timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("timeout must be positive");
        }
        Objects.requireNonNull(traceContext, "traceContext");
    }
}
