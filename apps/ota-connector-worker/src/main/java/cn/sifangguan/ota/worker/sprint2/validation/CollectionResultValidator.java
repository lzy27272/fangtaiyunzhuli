package cn.sifangguan.ota.worker.sprint2.validation;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_ENVELOPE_SCOPE_MISMATCH;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_ENVELOPE_SOURCE_MISMATCH;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_EVIDENCE_INVALID;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_IDEMPOTENCY_INVALID;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_SCHEMA_INVALID;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_STATUS_QUALITY_INVALID;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_TRUSTED_TIME_INVALID;
import static cn.sifangguan.ota.worker.sprint2.validation.CollectionResultRejectionReason.CONNECTOR_RESULT_WATERMARK_INVALID;

@Component
public final class CollectionResultValidator {
    public static final Duration TRUSTED_CLOCK_SKEW_TOLERANCE = Duration.ofMinutes(2);
    private static final Pattern WATERMARK_TYPE = Pattern.compile("[A-Z][A-Z0-9_]{1,63}");
    private static final Pattern SHA_256 = Pattern.compile("[0-9a-fA-F]{64}");
    private static final Pattern EVIDENCE_REFERENCE =
            Pattern.compile("(?:object|file|fixture)://[A-Za-z0-9._:/@+\\-]+");
    private static final Pattern WINDOWS_ABSOLUTE_FILE_REFERENCE =
            Pattern.compile("^file://[A-Za-z]:/.*$");
    private static final Pattern MEDIA_TYPE =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9!#$&^_.+\\-]{0,63}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+\\-]{0,63}");
    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:\\-]{7,254}");
    private static final Pattern RECORD_TYPE =
            Pattern.compile("[a-z][a-z0-9_.\\-]{2,63}");
    private static final List<String> FORBIDDEN_REFERENCE_MARKERS = List.of(
            "password",
            "passwd",
            "credential",
            "authorization",
            "cookie",
            "token",
            "secret",
            "webhook");

    public CollectionResult validate(
            CollectionRequest request,
            ConnectorDescriptor descriptor,
            CollectionResult result,
            Instant trustedFinishedAt) {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(descriptor, "descriptor");
        Objects.requireNonNull(trustedFinishedAt, "trustedFinishedAt");
        if (result == null) {
            reject(CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }

        validateTrustedTimeBoundary(request, result, trustedFinishedAt);
        validateStatusAndQuality(result);
        result.candidateWatermark().ifPresent(watermark -> {
            validateWatermark(watermark, result);
            validateCommittedWatermark(request, watermark);
        });
        result.sourceEffectiveAt().ifPresent(sourceEffectiveAt -> {
            if (sourceEffectiveAt.isAfter(result.observedAt())) {
                reject(CONNECTOR_RESULT_WATERMARK_INVALID);
            }
        });

        var topLevelEvidence = new HashSet<EvidenceReference>();
        var evidenceIds = new HashSet<String>();
        for (var evidence : result.evidenceReferences()) {
            validateEvidence(evidence);
            if (!topLevelEvidence.add(evidence) || !evidenceIds.add(evidence.referenceId())) {
                reject(CONNECTOR_RESULT_EVIDENCE_INVALID);
            }
        }

        Set<UUID> recordIds = new HashSet<>();
        Set<String> idempotencyKeys = new HashSet<>();
        Map<String, Class<?>> schemasByType = new HashMap<>();
        for (var envelope : result.records()) {
            validateEnvelopeScope(request, envelope);
            if (envelope.sourceSystem() != descriptor.sourceSystem()) {
                reject(CONNECTOR_RESULT_ENVELOPE_SOURCE_MISMATCH);
            }
            validateEnvelopeTimeBoundary(envelope, result);
            validateEvidence(envelope.evidence());
            if (!topLevelEvidence.contains(envelope.evidence())) {
                reject(CONNECTOR_RESULT_EVIDENCE_INVALID);
            }
            if (!recordIds.add(envelope.recordId())
                    || !IDEMPOTENCY_KEY.matcher(envelope.idempotencyKey()).matches()
                    || !idempotencyKeys.add(envelope.idempotencyKey())) {
                reject(CONNECTOR_RESULT_IDEMPOTENCY_INVALID);
            }
            validateRecordSchema(envelope, schemasByType);
        }
        result.candidateWatermark().ifPresent(watermark ->
                validateWatermarkAgainstRecords(watermark, result));
        return result;
    }

    private static void validateTrustedTimeBoundary(
            CollectionRequest request,
            CollectionResult result,
            Instant trustedFinishedAt) {
        Instant upperBound = trustedFinishedAt.plus(TRUSTED_CLOCK_SKEW_TOLERANCE);
        if (result.observedAt().isAfter(upperBound)
                || result.sourceEffectiveAt().stream().anyMatch(time -> time.isAfter(upperBound))
                || result.candidateWatermark().stream()
                .anyMatch(watermark -> watermark.sourceUpdatedAt().isAfter(upperBound))
                || request.committedWatermark().stream()
                .anyMatch(watermark -> watermark.sourceUpdatedAt().isAfter(upperBound))) {
            reject(CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
        }
        for (var envelope : result.records()) {
            if (envelope.observedAt().isAfter(upperBound)
                    || envelope.sourceEffectiveAt().stream()
                    .anyMatch(time -> time.isAfter(upperBound))
                    || envelope.sourceDetectionInterval().stream()
                    .anyMatch(interval ->
                            interval.fromExclusive().isAfter(upperBound)
                                    || interval.toInclusive().isAfter(upperBound))
                    || envelope.record().sourceUpdatedAt().isAfter(upperBound)) {
                reject(CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
            }
        }
    }

    private static void validateStatusAndQuality(CollectionResult result) {
        CompletenessState expected = switch (result.status()) {
            case SUCCESS -> CompletenessState.COMPLETE;
            case PARTIAL -> CompletenessState.PARTIAL;
            case AUTH_REQUIRED, FAILED -> CompletenessState.UNAVAILABLE;
        };
        if (result.quality().completeness() != expected) {
            reject(CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }
        boolean completeSuccess = result.status() == CollectionStatus.SUCCESS
                && result.quality().completeness() == CompletenessState.COMPLETE;
        if (completeSuccess
                && (result.quality().dataQuality() != DataQualityState.FRESH
                || result.quality().paginationValidation() == ValidationState.FAIL
                || result.quality().fieldValidation() == ValidationState.FAIL
                || result.quality().capabilityValidation() == ValidationState.FAIL
                || result.error().isPresent())) {
            reject(CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }
        if ((result.status() == CollectionStatus.AUTH_REQUIRED
                || result.status() == CollectionStatus.FAILED)
                && result.quality().dataQuality() != DataQualityState.UNAVAILABLE) {
            reject(CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }
        if (completeSuccess && result.candidateWatermark().isEmpty()) {
            reject(CONNECTOR_RESULT_WATERMARK_INVALID);
        }
        if (result.candidateWatermark().isPresent() && !completeSuccess) {
            reject(CONNECTOR_RESULT_WATERMARK_INVALID);
        }
    }

    private static void validateWatermark(CollectionWatermark watermark, CollectionResult result) {
        if (!WATERMARK_TYPE.matcher(watermark.type()).matches()
                || !safeOpaqueValue(watermark.opaqueValue())
                || watermark.sourceUpdatedAt().isAfter(result.observedAt())) {
            reject(CONNECTOR_RESULT_WATERMARK_INVALID);
        }
    }

    private static void validateCommittedWatermark(
            CollectionRequest request,
            CollectionWatermark candidate) {
        request.committedWatermark().ifPresent(committed -> {
            if (!WATERMARK_TYPE.matcher(committed.type()).matches()
                    || !safeOpaqueValue(committed.opaqueValue())
                    || !candidate.type().equals(committed.type())
                    || candidate.sourceUpdatedAt().isBefore(committed.sourceUpdatedAt())
                    || (candidate.sourceUpdatedAt().equals(committed.sourceUpdatedAt())
                    && !candidate.opaqueValue().equals(committed.opaqueValue()))) {
                reject(CONNECTOR_RESULT_WATERMARK_INVALID);
            }
        });
    }

    private static boolean safeOpaqueValue(String value) {
        if (value.length() > 512) {
            return false;
        }
        return value.chars().noneMatch(character ->
                Character.isISOControl(character) || Character.isSurrogate((char) character));
    }

    private static void validateEnvelopeScope(
            CollectionRequest request,
            StandardRecordEnvelope<?> envelope) {
        if (!envelope.tenantId().equals(request.scope().tenantId())
                || !envelope.hotelId().equals(request.scope().hotelId())
                || !envelope.connectorId().equals(request.connectorId())
                || !envelope.runId().equals(request.runId())
                || envelope.stream() != request.stream()) {
            reject(CONNECTOR_RESULT_ENVELOPE_SCOPE_MISMATCH);
        }
    }

    private static void validateEvidence(EvidenceReference evidence) {
        String reference = evidence.referenceId();
        String lower = reference.toLowerCase(Locale.ROOT);
        boolean containsTraversal = lower.contains("/../")
                || lower.endsWith("/..")
                || lower.contains("\\");
        boolean containsCredentialMarker = FORBIDDEN_REFERENCE_MARKERS.stream()
                .anyMatch(lower::contains);
        if (!EVIDENCE_REFERENCE.matcher(reference).matches()
                || reference.length() > 512
                || reference.contains("@")
                || containsTraversal
                || containsCredentialMarker
                || lower.startsWith("file:///")
                || WINDOWS_ABSOLUTE_FILE_REFERENCE.matcher(reference).matches()
                || !SHA_256.matcher(evidence.sha256()).matches()
                || !MEDIA_TYPE.matcher(evidence.mediaType()).matches()) {
            reject(CONNECTOR_RESULT_EVIDENCE_INVALID);
        }
    }

    private static void validateEnvelopeTimeBoundary(
            StandardRecordEnvelope<?> envelope,
            CollectionResult result) {
        if (envelope.observedAt().isAfter(result.observedAt())
                || envelope.sourceEffectiveAt().stream()
                .anyMatch(time -> time.isAfter(envelope.observedAt())
                        || time.isAfter(result.observedAt()))
                || envelope.sourceDetectionInterval().stream()
                .anyMatch(interval ->
                        interval.fromExclusive().isAfter(envelope.observedAt())
                                || interval.toInclusive().isAfter(envelope.observedAt())
                                || interval.fromExclusive().isAfter(result.observedAt())
                                || interval.toInclusive().isAfter(result.observedAt()))) {
            reject(CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
        }
    }

    private static void validateWatermarkAgainstRecords(
            CollectionWatermark watermark,
            CollectionResult result) {
        if (result.records().stream().anyMatch(envelope ->
                envelope.record().sourceUpdatedAt().isAfter(watermark.sourceUpdatedAt())
                        || envelope.sourceEffectiveAt().stream()
                        .anyMatch(time -> time.isAfter(watermark.sourceUpdatedAt()))
                        || envelope.sourceDetectionInterval().stream()
                        .anyMatch(interval ->
                                interval.toInclusive().isAfter(watermark.sourceUpdatedAt())))) {
            reject(CONNECTOR_RESULT_WATERMARK_INVALID);
        }
    }

    private static void validateRecordSchema(
            StandardRecordEnvelope<?> envelope,
            Map<String, Class<?>> schemasByType) {
        var record = envelope.record();
        String recordType = record.recordType();
        String sourceRecordKey = record.sourceRecordKey();
        if (recordType == null
                || !RECORD_TYPE.matcher(recordType).matches()
                || sourceRecordKey == null
                || sourceRecordKey.isBlank()
                || sourceRecordKey.length() > 512
                || sourceRecordKey.chars().anyMatch(Character::isISOControl)
                || record.sourceUpdatedAt() == null
                || record.sourceUpdatedAt().isAfter(envelope.observedAt())) {
            reject(CONNECTOR_RESULT_SCHEMA_INVALID);
        }
        Class<?> previous = schemasByType.putIfAbsent(recordType, record.getClass());
        if (previous != null && !previous.equals(record.getClass())) {
            reject(CONNECTOR_RESULT_SCHEMA_INVALID);
        }
    }

    private static void reject(CollectionResultRejectionReason reason) {
        throw new CollectionResultValidationException(reason);
    }
}
