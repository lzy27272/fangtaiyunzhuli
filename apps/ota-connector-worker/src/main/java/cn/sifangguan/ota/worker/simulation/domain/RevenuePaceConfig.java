package cn.sifangguan.ota.worker.simulation.domain;

import java.math.BigDecimal;
import java.util.Objects;

public record RevenuePaceConfig(
        long version,
        BigDecimal dailyTarget,
        BigDecimal targetAdr,
        BigDecimal revenuePaceStandard,
        BigDecimal sellPaceStandard) {

    public RevenuePaceConfig {
        if (version < 1) {
            throw new IllegalArgumentException("version must be positive");
        }
        requireNonNegative(dailyTarget, "dailyTarget");
        requireNonNegative(targetAdr, "targetAdr");
        requireNonNegative(revenuePaceStandard, "revenuePaceStandard");
        requireNonNegative(sellPaceStandard, "sellPaceStandard");
    }

    private static void requireNonNegative(BigDecimal value, String field) {
        Objects.requireNonNull(value, field);
        if (value.signum() < 0) {
            throw new IllegalArgumentException(field + " must not be negative");
        }
    }
}
