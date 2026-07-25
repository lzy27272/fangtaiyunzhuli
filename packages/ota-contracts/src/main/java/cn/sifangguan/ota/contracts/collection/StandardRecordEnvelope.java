package cn.sifangguan.ota.contracts.collection;

import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public record StandardRecordEnvelope<T extends StandardRecord>(
        UUID recordId,
        int schemaVersion,
        SourceSystem sourceSystem,
        UUID tenantId,
        UUID hotelId,
        UUID connectorId,
        UUID runId,
        DataStreamType stream,
        Optional<Instant> sourceEffectiveAt,
        Optional<SourceDetectionInterval> sourceDetectionInterval,
        Instant observedAt,
        String idempotencyKey,
        EvidenceReference evidence,
        T record) {

    public StandardRecordEnvelope {
        Objects.requireNonNull(recordId, "recordId");
        if (schemaVersion < 1) {
            throw new IllegalArgumentException("schemaVersion must be positive");
        }
        Objects.requireNonNull(sourceSystem, "sourceSystem");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(runId, "runId");
        Objects.requireNonNull(stream, "stream");
        sourceEffectiveAt = Objects.requireNonNull(sourceEffectiveAt, "sourceEffectiveAt");
        sourceDetectionInterval = Objects.requireNonNull(
                sourceDetectionInterval, "sourceDetectionInterval");
        Objects.requireNonNull(observedAt, "observedAt");
        if (sourceEffectiveAt.isPresent() == sourceDetectionInterval.isPresent()) {
            throw new IllegalArgumentException(
                    "exactly one of sourceEffectiveAt and sourceDetectionInterval is required");
        }
        sourceEffectiveAt.ifPresent(effectiveAt -> {
            if (effectiveAt.isAfter(observedAt)) {
                throw new IllegalArgumentException("sourceEffectiveAt must not follow observedAt");
            }
        });
        sourceDetectionInterval.ifPresent(interval -> {
            if (interval.toInclusive().isAfter(observedAt)) {
                throw new IllegalArgumentException(
                        "sourceDetectionInterval.toInclusive must not follow observedAt");
            }
        });
        idempotencyKey = requireText(idempotencyKey, "idempotencyKey");
        Objects.requireNonNull(evidence, "evidence");
        Objects.requireNonNull(record, "record");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
