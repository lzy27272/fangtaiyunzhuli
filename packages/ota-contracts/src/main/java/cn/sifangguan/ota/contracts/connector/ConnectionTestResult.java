package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.time.Instant;
import java.util.Objects;

public record ConnectionTestResult(
        ValidationState state,
        Instant observedAt,
        String sanitizedCode) {
    public ConnectionTestResult {
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(observedAt, "observedAt");
        sanitizedCode = Objects.requireNonNullElse(sanitizedCode, "");
    }
}
