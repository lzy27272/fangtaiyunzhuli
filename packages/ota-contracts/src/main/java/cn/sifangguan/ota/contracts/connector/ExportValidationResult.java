package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.util.List;
import java.util.Objects;

public record ExportValidationResult(ValidationState state, List<ValidationIssue> issues) {
    public ExportValidationResult {
        Objects.requireNonNull(state, "state");
        issues = List.copyOf(Objects.requireNonNull(issues, "issues"));
    }
}
