package cn.sifangguan.hotelaios.standards;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class StandardModels {
    private StandardModels() {
    }

    public record CreateStandard(
            @NotNull UUID categoryId,
            @NotBlank String code,
            @NotBlank String name,
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
            @NotBlank String title,
            @NotNull JsonNode items,
            JsonNode evidenceRequirements,
            JsonNode scoringRules,
            @NotEmpty List<@Valid Scope> scopes
    ) {
    }

    public record PublishVersion(@NotNull OffsetDateTime effectiveFrom, OffsetDateTime effectiveTo) {
    }
}

