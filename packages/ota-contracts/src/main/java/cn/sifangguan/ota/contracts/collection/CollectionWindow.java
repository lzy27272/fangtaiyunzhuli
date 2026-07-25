package cn.sifangguan.ota.contracts.collection;

import java.time.Instant;
import java.util.Objects;

public record CollectionWindow(Instant fromExclusive, Instant toInclusive) {
    public CollectionWindow {
        Objects.requireNonNull(fromExclusive, "fromExclusive");
        Objects.requireNonNull(toInclusive, "toInclusive");
        if (!fromExclusive.isBefore(toInclusive)) {
            throw new IllegalArgumentException("collection window must satisfy (fromExclusive, toInclusive]");
        }
    }
}
