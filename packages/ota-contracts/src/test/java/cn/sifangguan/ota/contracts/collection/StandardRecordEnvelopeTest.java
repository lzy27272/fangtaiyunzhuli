package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class StandardRecordEnvelopeTest {
    private static final Instant OBSERVED_AT = Instant.parse("2026-07-23T10:05:00Z");
    private static final SourceDetectionInterval DETECTION_INTERVAL = new SourceDetectionInterval(
            Instant.parse("2026-07-23T10:00:00Z"), OBSERVED_AT);

    @Test
    void preservesADetectionIntervalWithoutFabricatingAnExactEffectiveTime() {
        var envelope = envelope(Optional.empty(), Optional.of(DETECTION_INTERVAL));

        assertTrue(envelope.sourceEffectiveAt().isEmpty());
        assertEquals(DETECTION_INTERVAL, envelope.sourceDetectionInterval().orElseThrow());
    }

    @Test
    void preservesAnExactSourceEffectiveTimeWithoutADetectionInterval() {
        var effectiveAt = OBSERVED_AT.minusSeconds(30);

        var envelope = envelope(Optional.of(effectiveAt), Optional.empty());

        assertEquals(effectiveAt, envelope.sourceEffectiveAt().orElseThrow());
        assertTrue(envelope.sourceDetectionInterval().isEmpty());
    }

    @Test
    void rejectsMissingSourceTimeEvidence() {
        assertThrows(IllegalArgumentException.class, () ->
                envelope(Optional.empty(), Optional.empty()));
    }

    @Test
    void rejectsSimultaneousExactTimeAndDetectionInterval() {
        assertThrows(IllegalArgumentException.class, () -> envelope(
                Optional.of(OBSERVED_AT.minusSeconds(30)),
                Optional.of(DETECTION_INTERVAL)));
    }

    @Test
    void rejectsSourceTimeEvidenceThatFollowsObservation() {
        assertThrows(IllegalArgumentException.class, () -> envelope(
                Optional.of(OBSERVED_AT.plusSeconds(1)), Optional.empty()));
        assertThrows(IllegalArgumentException.class, () -> envelope(
                Optional.empty(),
                Optional.of(new SourceDetectionInterval(
                        OBSERVED_AT, OBSERVED_AT.plusSeconds(1)))));
    }

    private static StandardRecordEnvelope<FixtureRecord> envelope(
            Optional<Instant> sourceEffectiveAt,
            Optional<SourceDetectionInterval> sourceDetectionInterval) {
        return new StandardRecordEnvelope<>(
                UUID.randomUUID(),
                1,
                SourceSystem.PMS,
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                DataStreamType.BUSINESS_DATE,
                sourceEffectiveAt,
                sourceDetectionInterval,
                OBSERVED_AT,
                "pms-business-day:2026-07-23",
                new EvidenceReference("evidence-1", "sha256", "application/json", 1),
                new FixtureRecord("record-1", OBSERVED_AT));
    }

    private record FixtureRecord(String sourceRecordKey, Instant sourceUpdatedAt)
            implements StandardRecord {
        @Override
        public String recordType() {
            return "PMS_BUSINESS_DAY";
        }
    }
}
