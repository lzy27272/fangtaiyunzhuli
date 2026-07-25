package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CollectionResultContractTest {
    private static final Instant NOW = Instant.parse("2026-07-23T10:00:00Z");

    @Test
    void completenessVocabularyMatchesTheFrozenReportingContract() {
        assertArrayEquals(
                new CompletenessState[]{
                        CompletenessState.COMPLETE,
                        CompletenessState.PARTIAL,
                        CompletenessState.UNAVAILABLE},
                CompletenessState.values());
    }

    @Test
    void partialResultCannotAdvanceWatermark() {
        assertThrows(IllegalArgumentException.class, () -> new CollectionResult(
                CollectionStatus.PARTIAL,
                List.of(),
                Optional.of(new CollectionWatermark("cursor", "42", NOW)),
                Optional.of(NOW),
                NOW,
                List.of(),
                partialQuality(),
                Optional.empty()));
    }

    @Test
    void failedResultRequiresStructuredSanitizedError() {
        assertThrows(IllegalArgumentException.class, () -> new CollectionResult(
                CollectionStatus.FAILED,
                List.of(),
                Optional.empty(),
                Optional.empty(),
                NOW,
                List.of(),
                partialQuality(),
                Optional.empty()));
    }

    private static CollectionQuality partialQuality() {
        return new CollectionQuality(
                DataQualityState.SUSPECT,
                CompletenessState.PARTIAL,
                ValidationState.WARN,
                ValidationState.WARN,
                ValidationState.PASS,
                List.of());
    }
}
