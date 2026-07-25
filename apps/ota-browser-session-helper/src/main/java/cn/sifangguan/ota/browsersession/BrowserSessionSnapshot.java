package cn.sifangguan.ota.browsersession;

import java.time.Instant;
import java.util.Objects;

public record BrowserSessionSnapshot(
        BrowserSessionBinding binding,
        BrowserSessionState state,
        Instant changedAt,
        long revision) {

    public BrowserSessionSnapshot {
        Objects.requireNonNull(binding, "binding");
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(changedAt, "changedAt");
        if (revision < 0) {
            throw new IllegalArgumentException("revision must be non-negative");
        }
    }

    public static BrowserSessionSnapshot pending(
            BrowserSessionBinding binding,
            Instant createdAt) {
        return new BrowserSessionSnapshot(
                binding,
                BrowserSessionState.PENDING_INTERACTIVE_LOGIN,
                createdAt,
                0);
    }
}
