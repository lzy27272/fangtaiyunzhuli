package cn.sifangguan.ota.contracts.connector;

import java.time.Instant;
import java.util.Objects;

public record AuthorizationProbeResult(
        AuthorizationState state,
        Instant observedAt,
        String sanitizedCode) {
    public AuthorizationProbeResult {
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(observedAt, "observedAt");
        sanitizedCode = Objects.requireNonNullElse(sanitizedCode, "");
    }
}
