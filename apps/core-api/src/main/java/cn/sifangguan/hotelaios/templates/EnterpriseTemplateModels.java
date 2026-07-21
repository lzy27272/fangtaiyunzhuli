package cn.sifangguan.hotelaios.templates;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class EnterpriseTemplateModels {
    private EnterpriseTemplateModels() {
    }

    public record CreateTemplate(
            @NotBlank String templateType,
            @NotBlank String code,
            @NotBlank String name,
            String description,
            UUID targetPositionId,
            UUID ownerOrgUnitId,
            @NotNull JsonNode configuration
    ) {
    }

    public record CreateVersion(@NotNull JsonNode configuration) {
    }

    public record UpdateVersion(
            @NotNull JsonNode configuration,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record PublishVersion(OffsetDateTime effectiveFrom) {
    }
}
