package cn.sifangguan.hotelaios.workpackage;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class WorkPackageModels {
    private WorkPackageModels() {
    }

    public record CreateDefinition(
            @NotBlank String code,
            @NotBlank String name,
            String description,
            @NotNull UUID positionId,
            UUID ownerOrgUnitId
    ) {
    }

    public record CreateVersion(
            @NotBlank String title,
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

    public record StandardLink(
            @NotNull UUID standardVersionId,
            @NotBlank String usageType,
            BigDecimal weight
    ) {
    }

    public record Responsibility(
            @NotBlank String participantType,
            @NotBlank String resolverType,
            UUID positionId,
            String scopeStrategy,
            @PositiveOrZero Integer escalationLevel
    ) {
    }

    public record Item(
            @NotBlank String itemCode,
            @NotBlank String name,
            String description,
            @NotBlank String itemType,
            @NotNull UUID formVersionId,
            Integer sortOrder,
            Boolean required,
            @NotBlank String periodType,
            String timezoneMode,
            String fixedTimezone,
            LocalTime workWindowStart,
            LocalTime workWindowEnd,
            LocalTime dueLocalTime,
            @PositiveOrZero Integer graceMinutes,
            List<Integer> weekdays,
            Integer dayOfMonth,
            String holidayPolicy,
            Boolean waiverAllowed,
            String targetGranularity,
            String reviewMode,
            JsonNode submissionPolicy,
            List<@Valid StandardLink> standards,
            @NotEmpty List<@Valid Responsibility> responsibilities
    ) {
    }

    public record UpdateVersion(
            @NotBlank String title,
            String description,
            @NotEmpty List<@Valid Scope> scopes,
            @NotEmpty List<@Valid Item> items
    ) {
    }

    public record PublishVersion(
            @NotNull OffsetDateTime effectiveFrom,
            OffsetDateTime effectiveTo
    ) {
    }

    public record RetireVersion(OffsetDateTime effectiveTo) {
    }

    public record CreateAllocation(
            @NotNull UUID workPackageVersionId,
            @NotNull UUID positionAssignmentId,
            @NotNull UUID targetOrgUnitId,
            @NotNull LocalDate validFrom,
            LocalDate validTo,
            String allocationSource
    ) {
    }

    public record CreateDutyPeriod(
            @NotNull UUID positionAssignmentId,
            @NotNull UUID targetOrgUnitId,
            @NotNull LocalDate businessDate,
            @NotBlank String periodType,
            String shiftCode,
            @NotNull OffsetDateTime plannedStartAt,
            @NotNull OffsetDateTime plannedEndAt,
            String sourceRecordId
    ) {
    }

    public record GenerateExpectations(
            @NotNull UUID positionAssignmentId,
            @NotNull UUID targetOrgUnitId,
            @NotNull LocalDate businessDate,
            @NotBlank String periodType,
            UUID dutyPeriodId
    ) {
    }

    public record ExpectationAction(
            @NotBlank String reason,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record SlaProcessResult(
            int processedCount,
            int batchLimit,
            List<UUID> expectationIds,
            OffsetDateTime processedAt
    ) {
    }
}
