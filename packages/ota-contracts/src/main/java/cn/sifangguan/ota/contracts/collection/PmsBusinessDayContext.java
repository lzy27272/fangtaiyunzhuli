package cn.sifangguan.ota.contracts.collection;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Objects;

public record PmsBusinessDayContext(LocalDate businessDate, Instant observedAt) {
    public PmsBusinessDayContext {
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(observedAt, "observedAt");
    }
}
