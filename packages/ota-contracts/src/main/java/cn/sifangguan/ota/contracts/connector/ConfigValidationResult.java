package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.util.List;
import java.util.Objects;

public record ConfigValidationResult(ValidationState state, List<ValidationIssue> issues) {
    public ConfigValidationResult {
        Objects.requireNonNull(state, "state");
        issues = List.copyOf(Objects.requireNonNull(issues, "issues"));
        if (state == ValidationState.PASS && !issues.isEmpty()) {
            throw new IllegalArgumentException("PASS validation cannot contain issues");
        }
    }

    public static ConfigValidationResult pass() {
        return new ConfigValidationResult(ValidationState.PASS, List.of());
    }
}
