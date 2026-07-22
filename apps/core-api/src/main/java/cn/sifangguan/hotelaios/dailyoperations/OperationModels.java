package cn.sifangguan.hotelaios.dailyoperations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.UUID;

public final class OperationModels {
    private OperationModels() {
    }

    public record CreateIssue(
            @NotNull UUID orgUnitId,
            @NotNull LocalDate businessDate,
            @NotBlank String title,
            String description,
            String severity,
            UUID ownerAssignmentId,
            UUID verifierAssignmentId,
            OffsetDateTime dueAt,
            UUID createdByAssignmentId,
            String sourceType,
            UUID sourceId,
            JsonNode sourceSnapshot
    ) {
    }

    public record AddIssueSource(
            @NotBlank String sourceType,
            @NotNull UUID sourceId,
            String relationshipType,
            JsonNode sourceSnapshot
    ) {
    }

    public record IssueCommand(
            @PositiveOrZero long expectedVersion,
            UUID actorAssignmentId,
            UUID ownerAssignmentId,
            UUID verifierAssignmentId,
            String severity,
            String reason
    ) {
    }

    public record CreateTaskCandidate(
            @JsonAlias("sourceIssueId") UUID issueId,
            UUID orgUnitId,
            LocalDate businessDate,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID standardVersionId,
            @NotBlank String title,
            String description,
            String priority,
            OffsetDateTime dueAt,
            String acceptanceCriteria,
            UUID createdByAssignmentId,
            JsonNode sourceSnapshot
    ) {
    }

    public record CandidateDecision(
            @PositiveOrZero long expectedVersion,
            UUID actorAssignmentId,
            String reason
    ) {
    }

    public record CreateAiRequest(
            @NotBlank String purpose,
            String model,
            String promptVersion,
            String contextVersion,
            UUID orgUnitId,
            LocalDate businessDate,
            String sensitivityLevel,
            JsonNode contextSnapshot
    ) {
    }

    public record AiDecision(
            @NotBlank String decision,
            UUID actorAssignmentId,
            String reason,
            JsonNode acceptedDraft
    ) {
    }

    public record CreateExport(
            @NotBlank String exportType,
            String format,
            UUID orgUnitId,
            LocalDate businessDate,
            String sensitivityLevel,
            JsonNode filterSnapshot
    ) {
    }
}
