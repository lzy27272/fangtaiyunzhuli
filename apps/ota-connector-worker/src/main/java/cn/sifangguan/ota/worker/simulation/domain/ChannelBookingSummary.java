package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.util.Objects;

public record ChannelBookingSummary(
        SourceSystem channel,
        RoomNightBucket businessDayCumulative,
        RoomNightBucket hourWindow) {

    public ChannelBookingSummary {
        Objects.requireNonNull(channel, "channel");
        Objects.requireNonNull(businessDayCumulative, "businessDayCumulative");
        Objects.requireNonNull(hourWindow, "hourWindow");
    }
}
