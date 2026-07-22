package cn.sifangguan.hotelaios.dailyoperations;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/** API contracts for the governed V21 operation read side. */
public final class OperationIntelligenceModels {
    private OperationIntelligenceModels() {
    }

    public record OperationMetric(
            String code,
            String label,
            BigDecimal value,
            String unit,
            boolean available,
            String source
    ) {
    }

    public record IssueSummary(
            UUID id,
            String issueNo,
            String title,
            String description,
            String severity,
            String lifecycleStatus,
            String ownerName,
            UUID ownerAssignmentId,
            UUID reviewerAssignmentId,
            String hotelName,
            LocalDate businessDate,
            OffsetDateTime dueAt,
            boolean overdue,
            long sourceCount,
            long taskCount,
            OffsetDateTime updatedAt,
            long rowVersion
    ) {
    }

    public record DailyOperationOverview(
            UUID orgUnitId,
            String orgName,
            LocalDate businessDate,
            String timezone,
            String mode,
            UUID snapshotId,
            OffsetDateTime generatedAt,
            OffsetDateTime dataUpdatedAt,
            List<String> unavailableSources,
            List<OperationMetric> metrics,
            List<IssueSummary> issues,
            long actionItemCount,
            long unresolvedIssueCount,
            long overdueCount,
            long pendingTaskCandidateCount
    ) {
    }

    public record ActionItemView(
            UUID id,
            String actionType,
            String title,
            String description,
            String severity,
            String sourceType,
            UUID sourceId,
            String ownerName,
            OffsetDateTime dueAt,
            int escalationLevel,
            String syncStatus,
            List<String> allowedActions
    ) {
    }

    public record SnapshotSummary(
            UUID id,
            UUID orgUnitId,
            String orgName,
            LocalDate businessDate,
            int versionNo,
            String status,
            OffsetDateTime generatedAt,
            Integer completenessPercent,
            String correctionReason,
            long rowVersion
    ) {
    }

    public record SnapshotDetail(
            UUID id,
            UUID orgUnitId,
            String orgName,
            LocalDate businessDate,
            int versionNo,
            String status,
            OffsetDateTime generatedAt,
            Integer completenessPercent,
            String correctionReason,
            long rowVersion,
            DailyOperationOverview overview,
            UUID previousVersionId
    ) {
    }

    public record RetrySnapshotRequest(@NotNull @PositiveOrZero Long expectedVersion) {
    }

    public record CreateSnapshotRequest(
            UUID orgUnitId,
            LocalDate businessDate,
            UUID actorAssignmentId
    ) {
    }

    public record OperationExportView(
            UUID id,
            String exportType,
            LocalDate businessDate,
            String orgName,
            String status,
            boolean sensitiveIncluded,
            OffsetDateTime createdAt,
            OffsetDateTime expiresAt,
            String downloadUrl
    ) {
    }

    public record CreateExportRequest(
            @NotBlank String exportType,
            @NotNull LocalDate businessDate,
            UUID orgUnitId,
            boolean includeSensitive,
            UUID actorAssignmentId
    ) {
    }

    public record AiDecisionRequest(
            @NotBlank String decision,
            String note,
            @NotNull UUID actorAssignmentId
    ) {
    }

    public record AiDecisionView(
            UUID id,
            UUID recommendationId,
            String decision,
            String note,
            UUID actorAssignmentId,
            OffsetDateTime createdAt
    ) {
    }
}
