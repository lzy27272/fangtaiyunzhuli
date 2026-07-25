package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.DataQualityState;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

public final class SourceFreshnessEvaluator {
    private static final Duration GRACE = Duration.ofMinutes(2);

    public SourceFreshness evaluate(
            SourceSystem source,
            List<CollectionResult> requiredStreams,
            Duration configuredPeriod,
            Instant now) {
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(requiredStreams, "requiredStreams");
        Objects.requireNonNull(configuredPeriod, "configuredPeriod");
        Objects.requireNonNull(now, "now");
        if (configuredPeriod.isZero() || configuredPeriod.isNegative()) {
            throw new IllegalArgumentException("configuredPeriod must be positive");
        }
        if (requiredStreams.isEmpty()) {
            return new SourceFreshness(
                    source, false, Optional.empty(), List.of("NOT_CONFIGURED"));
        }

        var reasons = new ArrayList<String>();
        var lastObserved = requiredStreams.stream()
                .map(CollectionResult::observedAt)
                .max(Comparator.naturalOrder());
        for (var result : requiredStreams) {
            if (result.status() != CollectionStatus.SUCCESS) {
                reasons.add("SOURCE_FAILED");
            }
            if (result.quality().dataQuality() != DataQualityState.FRESH) {
                reasons.add("QUALITY_" + result.quality().dataQuality());
            }
        }
        var staleAfter = configuredPeriod.multipliedBy(2).plus(GRACE);
        var oldestObservation = requiredStreams.stream()
                .map(CollectionResult::observedAt)
                .min(Comparator.naturalOrder())
                .orElseThrow();
        if (oldestObservation.plus(staleAfter).isBefore(now)) {
            reasons.add("STALE");
        }
        if (oldestObservation.isAfter(now)) {
            reasons.add("OBSERVED_IN_FUTURE");
        }
        var distinctReasons = reasons.stream().distinct().toList();
        return new SourceFreshness(
                source,
                distinctReasons.isEmpty(),
                lastObserved,
                distinctReasons);
    }
}
