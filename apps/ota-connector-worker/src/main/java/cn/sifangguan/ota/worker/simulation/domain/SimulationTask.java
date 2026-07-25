package cn.sifangguan.ota.worker.simulation.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record SimulationTask(
        UUID taskId,
        UUID incidentId,
        String priority,
        String status,
        Instant createdAt,
        Instant dueAt) {

    public SimulationTask {
        Objects.requireNonNull(taskId, "taskId");
        Objects.requireNonNull(incidentId, "incidentId");
        priority = requireText(priority, "priority");
        status = requireText(status, "status");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(dueAt, "dueAt");
        if (!dueAt.equals(createdAt.plusSeconds(600))) {
            throw new IllegalArgumentException("Sprint 1 P1 task dueAt must be createdAt + 10 minutes");
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
