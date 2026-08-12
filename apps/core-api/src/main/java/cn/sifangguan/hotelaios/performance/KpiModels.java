package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public final class KpiModels {
    private KpiModels() {
    }

    public record CreateMetricVersion(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String unit,
            String valueType,
            @NotBlank String sourceType,
            @NotBlank String aggregation,
            String direction,
            JsonNode supportedDimensions,
            JsonNode calculation,
            String sensitivityLevel,
            LocalDate effectiveFrom
    ) {
    }

    public record PublishMetricVersion(LocalDate effectiveFrom) {
    }

    public record RecordMetricFact(
            @NotNull UUID metricVersionId,
            UUID orgUnitId,
            UUID employeeId,
            UUID positionAssignmentId,
            String channelCode,
            @NotNull LocalDate businessDate,
            LocalDate periodStart,
            LocalDate periodEnd,
            BigDecimal value,
            BigDecimal numerator,
            BigDecimal denominator,
            String dataState,
            @NotBlank String sourceType,
            String sourceRecordId,
            JsonNode sourceSnapshot,
            UUID supersedesFactId,
            @NotBlank String idempotencyKey
    ) {
    }

    public record CreatePolicy(
            @NotBlank String code,
            @NotBlank String name,
            UUID ownerOrgUnitId
    ) {
    }

    public record CreatePolicyVersion(
            @NotNull JsonNode scoreBands,
            @NotNull JsonNode attendanceBands,
            JsonNode zeroBonusRules,
            JsonNode roundingPolicy,
            LocalDate effectiveMonth,
            LocalDate expiresMonth
    ) {
    }

    public record CreateTemplate(
            @NotBlank String code,
            @NotBlank String name,
            String description,
            @NotBlank String templateOrigin,
            UUID ownerOrgUnitId,
            UUID positionId
    ) {
    }

    public record IndicatorInput(
            UUID id,
            @NotBlank String indicatorCode,
            @NotBlank String name,
            @NotBlank String indicatorType,
            String weeklySplitType,
            UUID metricVersionId,
            @NotNull BigDecimal maxScore,
            BigDecimal minScore,
            BigDecimal targetValue,
            Boolean allowAboveMax,
            @Min(0) @Max(6) Integer precisionScale,
            Boolean evidenceRequired,
            String evaluatorType,
            String notApplicablePolicy,
            Integer sortOrder,
            JsonNode formulaConfig,
            JsonNode warningConfig
    ) {
    }

    public record SectionInput(
            UUID id,
            @NotBlank String sectionCode,
            @NotBlank String name,
            @NotNull BigDecimal maxScore,
            BigDecimal minScore,
            Integer sortOrder,
            JsonNode configuration,
            @NotEmpty List<@Valid IndicatorInput> indicators
    ) {
    }

    public record CreateTemplateVersion(
            @NotBlank String title,
            String description,
            UUID baseTemplateVersionId,
            UUID compensationPolicyVersionId,
            @NotNull @DecimalMin("0") BigDecimal baseFullScore,
            Boolean allowExtraScore,
            LocalDate effectiveMonth,
            LocalDate expiresMonth,
            JsonNode configuration,
            @NotEmpty List<@Valid SectionInput> sections
    ) {
    }

    public record UpdateTemplateVersion(
            @NotBlank String title,
            String description,
            UUID baseTemplateVersionId,
            UUID compensationPolicyVersionId,
            @NotNull @DecimalMin("0") BigDecimal baseFullScore,
            Boolean allowExtraScore,
            LocalDate effectiveMonth,
            LocalDate expiresMonth,
            JsonNode configuration,
            @NotEmpty List<@Valid SectionInput> sections,
            @PositiveOrZero long expectedVersion
    ) {
        CreateTemplateVersion content() {
            return new CreateTemplateVersion(title, description, baseTemplateVersionId,
                    compensationPolicyVersionId, baseFullScore, allowExtraScore,
                    effectiveMonth, expiresMonth, configuration, sections);
        }
    }

    public record TemplateReview(
            @NotBlank String stage,
            @NotBlank String decision,
            String comment,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record TemplatePublish(
            LocalDate effectiveMonth,
            LocalDate expiresMonth,
            String comment,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record ScopeInput(
            @NotBlank String scopeType,
            UUID orgUnitId,
            String channelCode,
            Boolean primary,
            @NotNull LocalDate validFrom,
            LocalDate validTo
    ) {
    }

    public record CreateRelation(
            @NotNull UUID employeeId,
            @NotNull UUID positionAssignmentId,
            @NotNull UUID templateId,
            UUID evaluatorAssignmentId,
            UUID departmentReviewerAssignmentId,
            @NotNull LocalDate validFrom,
            LocalDate validTo,
            List<@Valid ScopeInput> scopes
    ) {
    }

    public record GeneratePeriod(
            @NotNull LocalDate monthStart,
            String generationType,
            @Min(1) @Max(4) Integer weekNo,
            String reason
    ) {
    }

    public record SubmitManualScore(
            @NotNull UUID indicatorRuleId,
            @NotNull UUID evaluatorAssignmentId,
            @NotNull BigDecimal score,
            @NotBlank String explanation,
            String evidenceReference,
            UUID supersedesManualScoreId
    ) {
    }

    public record ScorecardReview(
            @NotBlank String stage,
            @NotBlank String decision,
            String comment,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record CreateDispute(
            UUID indicatorRuleId,
            @NotBlank String reason
    ) {
    }

    public record ResolveDispute(
            @NotBlank String decision,
            @NotBlank String resolution,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record CreateCorrection(
            @NotBlank String correctionType,
            @NotBlank String reason
    ) {
    }

    public record ResolveCorrection(
            @NotBlank String decision,
            @NotBlank String resolution,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record SetBonusBase(
            @NotNull UUID employeeId,
            @NotNull LocalDate effectiveMonth,
            LocalDate expiresMonth,
            @NotNull @DecimalMin("0") BigDecimal amount,
            @NotBlank String reason
    ) {
    }

    public record LockPeriod(
            @PositiveOrZero long expectedVersion,
            String comment
    ) {
    }

    public record InspectionCheck(
            @NotBlank String code,
            @NotBlank String status,
            String note
    ) {
    }

    public record SubmitInspection(
            @NotNull UUID assignmentId,
            @NotNull UUID orgUnitId,
            @NotNull LocalDate businessDate,
            @NotBlank String timeSlot,
            @NotBlank String channelCode,
            @NotBlank String result,
            @NotEmpty List<@Valid InspectionCheck> checkItems,
            String abnormalityLevel,
            String abnormalityDescription,
            String firstAction,
            @NotBlank String idempotencyKey,
            UUID supersedesSubmissionId,
            String correctionReason
    ) {
    }

    public record InspectionEvent(
            @NotBlank String eventType,
            @NotBlank String note,
            String evidenceReference
    ) {
    }

    public record VerifyInspection(
            @NotBlank String decision,
            @NotBlank String finding,
            String evidenceReference
    ) {
    }

    public record UpdateInspectionSchedule(
            @NotBlank String opensAt,
            @NotBlank String cutoffAt,
            @NotEmpty List<@NotBlank String> requiredChecks,
            @NotNull Boolean active,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record ImportMapping(
            @NotNull UUID positionId,
            UUID ownerOrgUnitId,
            @NotBlank String templateCode,
            @NotBlank String templateName,
            @NotNull Map<String, String> fieldMapping
    ) {
    }

    public record SmartImportSelection(
            @NotBlank String sheetName,
            @NotNull UUID positionId,
            @NotBlank String templateCode,
            @NotBlank String templateName
    ) {
    }

    public record SmartImportRequest(
            @NotEmpty List<@Valid SmartImportSelection> templates
    ) {
    }

    public record CalculateSourcePreview(
            @NotNull UUID templateVersionId,
            @NotBlank String sourceHotelId,
            @NotNull LocalDate assessmentMonth
    ) {
    }

    public record TemplateRule(
            UUID id,
            String sectionCode,
            String indicatorCode,
            String name,
            String indicatorType,
            String weeklySplitType,
            UUID metricVersionId,
            BigDecimal maxScore,
            BigDecimal minScore,
            BigDecimal targetValue,
            boolean allowAboveMax,
            int precisionScale,
            boolean evidenceRequired,
            String evaluatorType,
            String notApplicablePolicy,
            JsonNode formulaConfig,
            JsonNode warningConfig
    ) {
    }

    public record MetricAggregate(
            String state,
            BigDecimal value,
            BigDecimal numerator,
            BigDecimal denominator,
            int observationCount,
            JsonNode sourceSnapshot
    ) {
    }

    public record IndicatorScore(
            UUID ruleId,
            String sectionCode,
            String indicatorCode,
            String name,
            String dataState,
            String outcome,
            BigDecimal targetValue,
            BigDecimal actualValue,
            BigDecimal numerator,
            BigDecimal denominator,
            BigDecimal score,
            BigDecimal maxScore,
            BigDecimal minScore,
            JsonNode details
    ) {
    }

    public record ScoreResult(
            List<IndicatorScore> indicators,
            BigDecimal baseScore,
            BigDecimal extraScore,
            BigDecimal finalScore,
            boolean pendingManual,
            boolean pendingVerification
    ) {
    }
}
