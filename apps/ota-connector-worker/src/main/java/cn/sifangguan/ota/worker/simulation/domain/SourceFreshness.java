package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

public record SourceFreshness(
        SourceSystem source,
        boolean fresh,
        Optional<Instant> lastObservedAt,
        List<String> reasons) {

    public SourceFreshness {
        Objects.requireNonNull(source, "source");
        lastObservedAt = Objects.requireNonNull(lastObservedAt, "lastObservedAt");
        reasons = List.copyOf(Objects.requireNonNull(reasons, "reasons"));
        if (fresh && (!reasons.isEmpty() || lastObservedAt.isEmpty())) {
            throw new IllegalArgumentException(
                    "fresh source must have an observation and no failure reasons");
        }
        if (!fresh && reasons.isEmpty()) {
            throw new IllegalArgumentException("non-fresh source requires a reason");
        }
    }
}
