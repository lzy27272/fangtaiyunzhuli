package cn.sifangguan.hotelaios.rules;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class RuleModels {
    private RuleModels() {
    }

    public record CreateRule(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String eventType,
            UUID ownerOrgUnitId,
            String description
    ) {
    }

    public record Scope(
            @NotBlank String scopeType,
            UUID brandId,
            UUID orgUnitId,
            UUID positionId
    ) {
    }

    public record CreateVersion(
            @NotNull JsonNode conditionAst,
            @NotNull JsonNode actions,
            Integer priority,
            Integer cooldownMinutes,
            @NotEmpty List<@Valid Scope> scopes
    ) {
    }

    public record UpdateVersion(
            @PositiveOrZero long expectedVersion,
            @NotNull JsonNode conditionAst,
            @NotNull JsonNode actions,
            Integer priority,
            Integer cooldownMinutes,
            @NotEmpty List<@Valid Scope> scopes
    ) {
    }

    public record PublishVersion(
            @PositiveOrZero long expectedVersion,
            @NotNull OffsetDateTime effectiveFrom,
            OffsetDateTime effectiveTo
    ) {
    }

    public record DisableVersion(@PositiveOrZero long expectedVersion) {
    }

    public record Simulation(
            @NotNull JsonNode facts
    ) {
    }
}
