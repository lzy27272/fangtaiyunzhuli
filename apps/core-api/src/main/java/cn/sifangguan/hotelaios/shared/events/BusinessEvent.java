package cn.sifangguan.hotelaios.shared.events;

import com.fasterxml.jackson.databind.JsonNode;

import java.time.LocalDate;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;

/**
 * Metadata required for a versioned Hotel AI OS business event.
 *
 * <p>The tenant, actor and correlation id are deliberately absent: the
 * publisher resolves them from the trusted {@code TenantContext}.</p>
 */
public record BusinessEvent(
        String aggregateType,
        UUID aggregateId,
        String eventType,
        int schemaVersion,
        String producer,
        UUID orgUnitId,
        UUID hotelOrgUnitId,
        UUID positionAssignmentId,
        UUID actorAssignmentId,
        LocalDate businessDate,
        UUID traceId,
        UUID causationId,
        String idempotencyKey,
        String sensitivity,
        JsonNode payload
) {
    public BusinessEvent {
        aggregateType = required(aggregateType, "aggregateType");
        aggregateId = Objects.requireNonNull(aggregateId, "aggregateId");
        eventType = EventTypeNames.normalize(eventType);
        if (schemaVersion < 1) {
            throw new IllegalArgumentException("schemaVersion must be positive");
        }
        producer = required(producer, "producer");
        sensitivity = sensitivity == null || sensitivity.isBlank()
                ? "INTERNAL" : sensitivity.trim().toUpperCase(Locale.ROOT);
        if (payload == null || !payload.isObject()) {
            throw new IllegalArgumentException("business event payload must be a JSON object");
        }
    }

    private static String required(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }
}
