package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.connector.CollectionStatus;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

public record CollectionResult(
        CollectionStatus status,
        List<StandardRecordEnvelope<?>> records,
        Optional<CollectionWatermark> candidateWatermark,
        Optional<Instant> sourceEffectiveAt,
        Instant observedAt,
        List<EvidenceReference> evidenceReferences,
        CollectionQuality quality,
        Optional<ConnectorError> error) {

    public CollectionResult {
        Objects.requireNonNull(status, "status");
        records = List.copyOf(Objects.requireNonNull(records, "records"));
        candidateWatermark = Objects.requireNonNull(candidateWatermark, "candidateWatermark");
        sourceEffectiveAt = Objects.requireNonNull(sourceEffectiveAt, "sourceEffectiveAt");
        Objects.requireNonNull(observedAt, "observedAt");
        evidenceReferences = List.copyOf(Objects.requireNonNull(evidenceReferences, "evidenceReferences"));
        Objects.requireNonNull(quality, "quality");
        error = Objects.requireNonNull(error, "error");

        if (status != CollectionStatus.SUCCESS && candidateWatermark.isPresent()) {
            throw new IllegalArgumentException("only a complete SUCCESS may advance the candidate watermark");
        }
        if (status == CollectionStatus.SUCCESS && error.isPresent()) {
            throw new IllegalArgumentException("SUCCESS must not contain an error");
        }
        if ((status == CollectionStatus.AUTH_REQUIRED || status == CollectionStatus.FAILED) && error.isEmpty()) {
            throw new IllegalArgumentException(status + " must contain a structured sanitized error");
        }
    }
}
