package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.connector.ValidationIssue;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;

import java.util.List;
import java.util.Objects;

public record CollectionQuality(
        DataQualityState dataQuality,
        CompletenessState completeness,
        ValidationState paginationValidation,
        ValidationState fieldValidation,
        ValidationState capabilityValidation,
        List<ValidationIssue> issues) {

    public CollectionQuality {
        Objects.requireNonNull(dataQuality, "dataQuality");
        Objects.requireNonNull(completeness, "completeness");
        Objects.requireNonNull(paginationValidation, "paginationValidation");
        Objects.requireNonNull(fieldValidation, "fieldValidation");
        Objects.requireNonNull(capabilityValidation, "capabilityValidation");
        issues = List.copyOf(Objects.requireNonNull(issues, "issues"));
    }
}
