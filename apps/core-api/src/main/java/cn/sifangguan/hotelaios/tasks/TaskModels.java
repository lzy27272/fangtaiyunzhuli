package cn.sifangguan.hotelaios.tasks;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class TaskModels {
    private TaskModels() {
    }

    public record CreateTask(
            @NotNull UUID orgUnitId,
            @NotNull UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID standardVersionId,
            UUID workRecordId,
            @NotBlank String title,
            String description,
            String priority,
            OffsetDateTime dueAt,
            JsonNode sourceSnapshot,
            UUID creatorAssignmentId,
            Boolean dispatchNow
    ) {
    }

    public record Command(
            @PositiveOrZero long expectedVersion,
            UUID actorAssignmentId,
            JsonNode payload
    ) {
    }

    public record AddEvidence(
            @NotNull UUID submittedByAssignmentId,
            @NotBlank String evidenceType,
            String objectKey,
            String originalName,
            String mediaType,
            Long sizeBytes,
            String sha256,
            JsonNode structuredResult
    ) {
    }

    public record RuleTaskSpec(
            UUID sourceEventId,
            UUID sourceActionId,
            UUID orgUnitId,
            UUID assigneeAssignmentId,
            UUID reviewerAssignmentId,
            UUID standardVersionId,
            UUID workRecordId,
            String title,
            String description,
            String priority,
            OffsetDateTime dueAt,
            JsonNode sourceSnapshot
    ) {
    }

    /**
     * A human-confirmed task candidate promoted into the existing task center.
     * The candidate remains the source of truth for the confirmation and sync
     * lifecycle; the task center only receives the immutable responsibility
     * and source snapshot required to create the formal task.
     */
    public record CandidateTaskSpec(
            @NotNull UUID candidateId,
            @NotNull UUID orgUnitId,
            @NotNull UUID assigneeAssignmentId,
            @NotNull UUID reviewerAssignmentId,
            UUID standardVersionId,
            @NotBlank String title,
            String description,
            String priority,
            OffsetDateTime dueAt,
            JsonNode sourceSnapshot
    ) {
    }

    public record TaskReference(
            UUID id,
            String taskNo,
            UUID orgUnitId,
            String title,
            String lifecycleStatus,
            long rowVersion
    ) {
    }
}
