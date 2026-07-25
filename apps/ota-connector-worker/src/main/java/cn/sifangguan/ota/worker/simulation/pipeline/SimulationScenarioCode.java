package cn.sifangguan.ota.worker.simulation.pipeline;

import java.util.Locale;
import java.util.Objects;

public enum SimulationScenarioCode {
    BASELINE,
    INVENTORY_MISMATCH,
    SOURCE_UNAVAILABLE,
    LATE_BRIEF_REPLAY;

    public static SimulationScenarioCode parse(String value) {
        Objects.requireNonNull(value, "scenarioCode");
        try {
            return valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException(
                    "unsupported simulation scenario: " + value,
                    exception);
        }
    }
}
