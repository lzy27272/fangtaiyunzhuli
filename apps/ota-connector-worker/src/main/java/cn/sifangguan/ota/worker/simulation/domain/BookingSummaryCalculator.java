package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

public final class BookingSummaryCalculator {
    public ChannelBookingSummary summarize(
            SourceSystem channel,
            List<RoomNightDelta> deltas,
            LocalDate businessDate,
            Instant fromExclusive,
            Instant toInclusive) {
        Objects.requireNonNull(channel, "channel");
        Objects.requireNonNull(deltas, "deltas");
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(fromExclusive, "fromExclusive");
        Objects.requireNonNull(toInclusive, "toInclusive");
        if (!fromExclusive.isBefore(toInclusive)) {
            throw new IllegalArgumentException("hour window must satisfy (fromExclusive,toInclusive]");
        }

        var cumulative = bucket(deltas.stream()
                .filter(delta -> delta.channel() == channel)
                .filter(delta -> delta.eventBusinessDate().equals(businessDate))
                .toList(), businessDate);
        var hour = bucket(deltas.stream()
                .filter(delta -> delta.channel() == channel)
                .filter(delta -> delta.eventBusinessDate().equals(businessDate))
                .filter(delta -> delta.eventAt().isAfter(fromExclusive)
                        && !delta.eventAt().isAfter(toInclusive))
                .toList(), businessDate);
        return new ChannelBookingSummary(channel, cumulative, hour);
    }

    private static RoomNightBucket bucket(
            List<RoomNightDelta> deltas,
            LocalDate businessDate) {
        int addedToday = 0;
        int addedFuture = 0;
        int removedToday = 0;
        int removedFuture = 0;
        int anomaly = 0;
        for (var delta : deltas) {
            var dateOrder = delta.stay().stayDate().compareTo(businessDate);
            if (dateOrder < 0) {
                anomaly += Math.abs(delta.quantity());
                continue;
            }
            var positive = delta.quantity() > 0;
            var quantity = Math.abs(delta.quantity());
            if (dateOrder == 0 && positive) {
                addedToday += quantity;
            } else if (dateOrder > 0 && positive) {
                addedFuture += quantity;
            } else if (dateOrder == 0) {
                removedToday += quantity;
            } else {
                removedFuture += quantity;
            }
        }
        return new RoomNightBucket(
                addedToday, addedFuture, removedToday, removedFuture, anomaly);
    }
}
