package cn.sifangguan.ota.contracts.event;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record DomainEventEnvelope<T extends DomainEventPayload>(
        UUID eventId,
        String eventType,
        int schemaVersion,
        SourceSystem sourceSystem,
        Instant occurredAt,
        UUID tenantRef,
        UUID hotelRef,
        UUID aggregateId,
        long aggregateVersion,
        String correlationId,
        Optional<String> causationId,
        String idempotencyKey,
        T payload) {

    public DomainEventEnvelope {
        Objects.requireNonNull(eventId, "eventId");
        eventType = requireText(eventType, "eventType");
        if (schemaVersion < 1) {
            throw new IllegalArgumentException("schemaVersion must be positive");
        }
        Objects.requireNonNull(sourceSystem, "sourceSystem");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Objects.requireNonNull(tenantRef, "tenantRef");
        Objects.requireNonNull(hotelRef, "hotelRef");
        Objects.requireNonNull(aggregateId, "aggregateId");
        if (aggregateVersion < 1) {
            throw new IllegalArgumentException("aggregateVersion must be positive");
        }
        correlationId = requireText(correlationId, "correlationId");
        causationId = Objects.requireNonNull(causationId, "causationId")
                .map(value -> requireText(value, "causationId"));
        idempotencyKey = requireText(idempotencyKey, "idempotencyKey");
        Objects.requireNonNull(payload, "payload");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
