package cn.sifangguan.ota.worker.simulation.domain;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.Optional;

public record MetricValue(MetricState state, Optional<BigDecimal> value, String reason) {
    public MetricValue {
        Objects.requireNonNull(state, "state");
        value = Objects.requireNonNull(value, "value");
        reason = Objects.requireNonNullElse(reason, "");
        if ((state == MetricState.AVAILABLE) != value.isPresent()) {
            throw new IllegalArgumentException(
                    "only AVAILABLE metric values may contain a decimal value");
        }
        if (state != MetricState.AVAILABLE && reason.isBlank()) {
            throw new IllegalArgumentException("non-available metric requires a reason");
        }
    }

    public static MetricValue available(BigDecimal value) {
        return new MetricValue(
                MetricState.AVAILABLE,
                Optional.of(Objects.requireNonNull(value, "value")),
                "");
    }

    public static MetricValue notApplicable(String reason) {
        return unavailable(MetricState.NOT_APPLICABLE, reason);
    }

    public static MetricValue notConfigured(String reason) {
        return unavailable(MetricState.NOT_CONFIGURED, reason);
    }

    public static MetricValue unavailable(String reason) {
        return unavailable(MetricState.UNAVAILABLE, reason);
    }

    public static MetricValue consistencyError(String reason) {
        return unavailable(MetricState.CONSISTENCY_ERROR, reason);
    }

    private static MetricValue unavailable(MetricState state, String reason) {
        Objects.requireNonNull(reason, "reason");
        if (reason.isBlank()) {
            throw new IllegalArgumentException("reason must not be blank");
        }
        return new MetricValue(state, Optional.empty(), reason);
    }

    public BigDecimal requiredValue() {
        return value.orElseThrow(() -> new IllegalStateException(
                "metric is not available: " + state + " / " + reason));
    }
}
