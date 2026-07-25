package cn.sifangguan.ota.worker.simulation.persistence;

import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class DynamicScheduleDispatcherTest {
    @Test
    void dispatchesConfiguredSchedulesUsingTheServicePrincipalAndDatabaseClock() {
        var now = Instant.parse("2026-07-23T04:06:00Z");
        var principalId = UUID.fromString("50000000-0000-4000-8000-000000000001");
        var port = new RecordingPort();

        new DynamicScheduleDispatcher(
                port,
                principalId,
                Clock.fixed(now, ZoneOffset.UTC),
                37).dispatchOnce();

        assertEquals(principalId, port.principalId);
        assertEquals(now, port.now);
        assertEquals(37, port.batchLimit);
        assertEquals(1, port.calls);
    }

    @Test
    void rejectsAnUnboundedDispatchBatch() {
        assertThrows(IllegalArgumentException.class, () -> new DynamicScheduleDispatcher(
                new RecordingPort(),
                UUID.randomUUID(),
                Clock.systemUTC(),
                501));
    }

    private static final class RecordingPort implements DynamicSchedulePort {
        private UUID principalId;
        private Instant now;
        private int batchLimit;
        private int calls;

        @Override
        public int dispatchDue(UUID principalId, Instant now, int batchLimit) {
            this.principalId = principalId;
            this.now = now;
            this.batchLimit = batchLimit;
            calls++;
            return 1;
        }
    }
}
