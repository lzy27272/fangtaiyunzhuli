package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public interface TaskProjectionPort {
    ProjectionReceipt project(ReadOnlyTaskProjection projection);

    record ReadOnlyTaskProjection(
            UUID taskId,
            TenantHotelRef scope,
            String taskType,
            String status,
            Instant occurredAt,
            long aggregateVersion) {
        public ReadOnlyTaskProjection {
            Objects.requireNonNull(taskId, "taskId");
            Objects.requireNonNull(scope, "scope");
            taskType = requireText(taskType, "taskType");
            status = requireText(status, "status");
            Objects.requireNonNull(occurredAt, "occurredAt");
            if (aggregateVersion < 1) {
                throw new IllegalArgumentException("aggregateVersion must be positive");
            }
        }
    }

    record ProjectionReceipt(String projectionId, boolean accepted) {
        public ProjectionReceipt {
            projectionId = requireText(projectionId, "projectionId");
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
