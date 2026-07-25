package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.record.BookingRevisionRecord;
import cn.sifangguan.ota.contracts.record.RoomNightStay;

import java.util.ArrayList;
import java.util.Objects;
import java.util.TreeSet;

public final class BookingDeltaCalculator {
    public java.util.List<RoomNightDelta> expand(
            SourceSystem channel,
            java.util.List<BookingRevisionRecord> revisions) {
        Objects.requireNonNull(channel, "channel");
        Objects.requireNonNull(revisions, "revisions");
        var deltas = new ArrayList<RoomNightDelta>();

        revisions.stream()
                .sorted(java.util.Comparator
                        .comparing(BookingRevisionRecord::eventAt)
                        .thenComparing(BookingRevisionRecord::sourceRecordKey))
                .forEach(revision -> {
                    var stays = new TreeSet<RoomNightStay>();
                    stays.addAll(revision.beforeRoomNights().keySet());
                    stays.addAll(revision.afterRoomNights().keySet());
                    for (var stay : stays) {
                        var before = revision.beforeRoomNights().getOrDefault(stay, 0);
                        var after = revision.afterRoomNights().getOrDefault(stay, 0);
                        var difference = after - before;
                        if (difference == 0) {
                            continue;
                        }
                        var reason = reason(revision, before, difference);
                        deltas.add(new RoomNightDelta(
                                channel,
                                revision.externalBookingId(),
                                revision.revisionKey(),
                                revision.eventAt(),
                                revision.eventBusinessDate(),
                                stay,
                                difference,
                                reason));
                    }
                });
        return java.util.List.copyOf(deltas);
    }

    private static RoomNightDeltaReason reason(
            BookingRevisionRecord revision,
            int before,
            int difference) {
        if (difference > 0) {
            return before == 0
                    ? RoomNightDeltaReason.BOOKED
                    : RoomNightDeltaReason.MODIFIED_ADD;
        }
        return revision.wholeOrderCancellation()
                ? RoomNightDeltaReason.CANCELLED
                : RoomNightDeltaReason.MODIFIED_REMOVE;
    }
}
