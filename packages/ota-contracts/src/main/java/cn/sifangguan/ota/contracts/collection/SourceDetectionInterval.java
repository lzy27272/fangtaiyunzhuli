package cn.sifangguan.ota.contracts.collection;

import java.time.Instant;
import java.util.Objects;

/**
 * Evidence interval used when a source does not provide an exact effective timestamp.
 * The event occurred in {@code (fromExclusive, toInclusive]} and must not be collapsed
 * into a fabricated point in time.
 */
public record SourceDetectionInterval(Instant fromExclusive, Instant toInclusive) {
    public SourceDetectionInterval {
        Objects.requireNonNull(fromExclusive, "fromExclusive");
        Objects.requireNonNull(toInclusive, "toInclusive");
        if (!fromExclusive.isBefore(toInclusive)) {
            throw new IllegalArgumentException(
                    "source detection interval must satisfy (fromExclusive, toInclusive]");
        }
    }
}
