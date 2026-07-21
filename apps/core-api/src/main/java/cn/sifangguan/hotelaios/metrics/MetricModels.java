package cn.sifangguan.hotelaios.metrics;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public final class MetricModels {
    private MetricModels() {
    }

    public record CreateMetric(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String unit,
            String valueType,
            String aggregation,
            String description
    ) {
    }

    public record RecordObservation(
            @NotNull UUID hotelOrgUnitId,
            @NotNull UUID metricId,
            @NotNull LocalDate businessDate,
            @NotNull BigDecimal value,
            @NotBlank String sourceType,
            String sourceRecordId
    ) {
    }
}

