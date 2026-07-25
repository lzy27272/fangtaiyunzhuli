package cn.sifangguan.ota.contracts.event;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;

class DomainEventEnvelopeTest {
    private record FixturePayload(String state) implements DomainEventPayload {
    }

    @Test
    void rejectsAZeroSchemaVersion() {
        assertThrows(IllegalArgumentException.class, () -> envelope(0, "ota.collection.completed.v1"));
    }

    @Test
    void rejectsABlankRequiredEventType() {
        assertThrows(IllegalArgumentException.class, () -> envelope(1, " "));
    }

    private static DomainEventEnvelope<FixturePayload> envelope(int schemaVersion, String eventType) {
        return new DomainEventEnvelope<>(
                UUID.randomUUID(),
                eventType,
                schemaVersion,
                SourceSystem.OTA_STANDALONE,
                Instant.parse("2026-07-23T10:00:00Z"),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                1,
                "correlation-test",
                Optional.empty(),
                "event:test:1",
                new FixturePayload("COMPLETED"));
    }
}
