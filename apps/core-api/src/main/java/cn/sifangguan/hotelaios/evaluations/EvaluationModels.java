package cn.sifangguan.hotelaios.evaluations;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.util.List;
import java.util.UUID;

public final class EvaluationModels {
    private EvaluationModels() {
    }

    public record CreateEvaluation(
            @NotBlank String subjectType,
            @NotNull UUID subjectId,
            @NotNull UUID orgUnitId,
            UUID positionAssignmentId,
            @NotNull UUID standardVersionId,
            @NotNull JsonNode inputSnapshot
    ) {
    }

    public record ManualItem(
            @NotBlank String itemCode,
            @NotBlank String outcome,
            Double score,
            String reason,
            JsonNode actualValue
    ) {
    }

    public record ManualReview(
            @PositiveOrZero long expectedVersion,
            @NotNull UUID reviewerAssignmentId,
            @NotEmpty List<@Valid ManualItem> items
    ) {
    }
}
