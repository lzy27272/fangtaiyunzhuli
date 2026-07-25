package cn.sifangguan.ota.worker.simulation.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record SimulationOutboxPreview(
        UUID eventId,
        String messageType,
        String businessMessageKey,
        String frozenBody,
        String contentSha256,
        boolean mentionAll,
        OutboxEnvironment environment,
        OutboxDeliveryState deliveryState,
        Instant createdAt) {

    public SimulationOutboxPreview {
        Objects.requireNonNull(eventId, "eventId");
        messageType = requireText(messageType, "messageType");
        businessMessageKey = requireText(businessMessageKey, "businessMessageKey");
        frozenBody = requireText(frozenBody, "frozenBody");
        contentSha256 = requireText(contentSha256, "contentSha256");
        Objects.requireNonNull(environment, "environment");
        Objects.requireNonNull(deliveryState, "deliveryState");
        Objects.requireNonNull(createdAt, "createdAt");
        if (environment != OutboxEnvironment.SIMULATION
                || deliveryState != OutboxDeliveryState.DELIVERY_BLOCKED) {
            throw new IllegalArgumentException(
                    "Sprint 1 preview outbox must remain SIMULATION/DELIVERY_BLOCKED");
        }
        if (!frozenBody.startsWith("【SIMULATION｜DELIVERY_BLOCKED】")) {
            throw new IllegalArgumentException(
                    "simulation message body must contain the visible safety banner");
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
