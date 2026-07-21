package cn.sifangguan.hotelaios.shared.events;

import java.util.UUID;

public record OutboxCreatedEvent(UUID tenantId, UUID outboxEventId, UUID correlationId) {
}
