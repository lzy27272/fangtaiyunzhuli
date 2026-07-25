package cn.sifangguan.ota.api.audit;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AuditEvent(
        UUID id,
        String eventType,
        UUID actorAccountId,
        String outcome,
        String reasonCode,
        String correlationId,
        Instant occurredAt,
        String resourceType,
        UUID resourceId,
        UUID targetTenantId,
        UUID targetHotelId,
        String coverageCode,
        String conditionHash
) {
    public AuditEvent(
            UUID id,
            String eventType,
            UUID actorAccountId,
            String outcome,
            String reasonCode,
            String correlationId,
            Instant occurredAt
    ) {
        this(id, eventType, actorAccountId, outcome, reasonCode, correlationId, occurredAt,
                null, null, null, null, null, null);
    }

    public AuditEvent {
        Objects.requireNonNull(id, "id");
        eventType = requireText(eventType, "eventType");
        outcome = requireText(outcome, "outcome");
        correlationId = requireText(correlationId, "correlationId");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if (targetHotelId != null && targetTenantId == null) {
            throw new IllegalArgumentException("targetHotelId requires targetTenantId");
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
