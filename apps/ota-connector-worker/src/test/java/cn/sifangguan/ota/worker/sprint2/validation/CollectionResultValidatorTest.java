package cn.sifangguan.ota.worker.sprint2.validation;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.ConnectorError;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.contracts.record.PmsBusinessDateRecord;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class CollectionResultValidatorTest {
    private static final String SHA =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    private final CollectionResultValidator validator = new CollectionResultValidator();
    private final ConnectorDescriptor descriptor =
            new TestSourceConnector("pms.fixture", ignored -> CollectionFixtures.success()).descriptor();

    @Test
    void acceptsACompleteScopedAndEvidenceBackedResult() {
        var request = CollectionFixtures.request();
        var result = validResult(request, validEnvelope(request, validEvidence(), validRecord(), "record:key-0001"));

        assertDoesNotThrow(() -> validator.validate(
                request,
                descriptor,
                result,
                CollectionFixtures.NOW));
    }

    @Test
    void rejectsStatusCompletenessMismatchWithFixedCode() {
        var request = CollectionFixtures.request();
        var result = new CollectionResult(
                CollectionStatus.PARTIAL,
                List.of(),
                Optional.empty(),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(),
                quality(CompletenessState.COMPLETE),
                Optional.empty());

        assertRejected(
                request,
                result,
                CollectionResultRejectionReason.CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
    }

    @Test
    void rejectsUnsafeOrFutureWatermarkWithFixedCode() {
        var request = CollectionFixtures.request();
        var result = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(),
                Optional.of(new CollectionWatermark(
                        "unsafe-type",
                        "cursor",
                        CollectionFixtures.NOW.plusSeconds(1))),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(),
                quality(CompletenessState.COMPLETE),
                Optional.empty());

        assertRejected(
                request,
                result,
                CollectionResultRejectionReason.CONNECTOR_RESULT_WATERMARK_INVALID);
    }

    @Test
    void rejectsCompleteSuccessWithoutCandidateWatermark() {
        var request = CollectionFixtures.request();
        var result = completeResult(Optional.empty(), quality(CompletenessState.COMPLETE));

        assertRejected(
                request,
                result,
                CollectionResultRejectionReason.CONNECTOR_RESULT_WATERMARK_INVALID);
    }

    @Test
    void acceptsAnIdempotentOrForwardCandidateAgainstCommittedWatermark() {
        var committed = new CollectionWatermark(
                "UPDATED_AT",
                "cursor-200",
                CollectionFixtures.NOW.minusSeconds(60));
        var request = withCommitted(CollectionFixtures.request(), committed);
        var same = completeResult(
                Optional.of(committed),
                quality(CompletenessState.COMPLETE));
        var forward = completeResult(
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-300",
                        CollectionFixtures.NOW.minusSeconds(30))),
                quality(CompletenessState.COMPLETE));

        assertDoesNotThrow(() -> validator.validate(
                request,
                descriptor,
                same,
                CollectionFixtures.NOW));
        assertDoesNotThrow(() -> validator.validate(
                request,
                descriptor,
                forward,
                CollectionFixtures.NOW));
    }

    @Test
    void rejectsCandidateTypeTimeAndSamePositionCursorReplacement() {
        var committed = new CollectionWatermark(
                "UPDATED_AT",
                "cursor-200",
                CollectionFixtures.NOW.minusSeconds(60));
        var request = withCommitted(CollectionFixtures.request(), committed);
        var typeMismatch = new CollectionWatermark(
                "PAGE_TOKEN",
                "cursor-300",
                CollectionFixtures.NOW.minusSeconds(30));
        var timeRegression = new CollectionWatermark(
                "UPDATED_AT",
                "cursor-300",
                CollectionFixtures.NOW.minusSeconds(90));
        var samePositionReplacement = new CollectionWatermark(
                "UPDATED_AT",
                "cursor-100",
                CollectionFixtures.NOW.minusSeconds(60));

        for (var candidate : List.of(typeMismatch, timeRegression, samePositionReplacement)) {
            assertRejected(
                    request,
                    completeResult(
                            Optional.of(candidate),
                            quality(CompletenessState.COMPLETE)),
                    CollectionResultRejectionReason.CONNECTOR_RESULT_WATERMARK_INVALID);
        }
    }

    @Test
    void rejectsUnavailableOrFailedQualityOnCompleteSuccess() {
        var request = CollectionFixtures.request();
        var candidate = Optional.of(new CollectionWatermark(
                "UPDATED_AT",
                "cursor-300",
                CollectionFixtures.NOW.minusSeconds(30)));
        var invalidQualities = List.of(
                quality(
                        DataQualityState.UNAVAILABLE,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS),
                quality(
                        DataQualityState.SUSPECT,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS),
                quality(
                        DataQualityState.RECOVERY_VERIFYING,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.PASS),
                quality(
                        DataQualityState.FRESH,
                        ValidationState.FAIL,
                        ValidationState.PASS,
                        ValidationState.PASS),
                quality(
                        DataQualityState.FRESH,
                        ValidationState.PASS,
                        ValidationState.FAIL,
                        ValidationState.PASS),
                quality(
                        DataQualityState.FRESH,
                        ValidationState.PASS,
                        ValidationState.PASS,
                        ValidationState.FAIL));

        for (var invalidQuality : invalidQualities) {
            assertRejected(
                    request,
                    completeResult(candidate, invalidQuality),
                    CollectionResultRejectionReason.CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }
    }

    @Test
    void requiresUnavailableDataQualityForAuthAndFailedResults() {
        var request = CollectionFixtures.request();
        var wrongQuality = quality(
                DataQualityState.FRESH,
                ValidationState.FAIL,
                ValidationState.FAIL,
                ValidationState.FAIL,
                CompletenessState.UNAVAILABLE);
        for (var status : List.of(
                CollectionStatus.AUTH_REQUIRED,
                CollectionStatus.FAILED)) {
            var result = new CollectionResult(
                    status,
                    List.of(),
                    Optional.empty(),
                    Optional.empty(),
                    CollectionFixtures.NOW,
                    List.of(),
                    wrongQuality,
                    Optional.of(new ConnectorError(
                            "SOURCE_UNAVAILABLE",
                            false,
                            "source unavailable")));
            assertRejected(
                    request,
                    result,
                    CollectionResultRejectionReason.CONNECTOR_RESULT_STATUS_QUALITY_INVALID);
        }
    }

    @Test
    void rejectsConnectorControlledFutureTimesBeyondTrustedCompletionBoundary() {
        var request = CollectionFixtures.request();
        var future = CollectionFixtures.NOW
                .plus(CollectionResultValidator.TRUSTED_CLOCK_SKEW_TOLERANCE)
                .plusSeconds(1);
        var futureResult = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-999",
                        future)),
                Optional.of(future),
                future,
                List.of(),
                quality(CompletenessState.COMPLETE),
                Optional.empty());

        assertRejected(
                request,
                futureResult,
                CollectionResultRejectionReason.CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
    }

    @Test
    void rejectsFutureEnvelopeTimesEvenWhenTopLevelTimeLooksCurrent() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var future = CollectionFixtures.NOW
                .plus(CollectionResultValidator.TRUSTED_CLOCK_SKEW_TOLERANCE)
                .plusSeconds(1);
        var futureRecord = new PmsBusinessDateRecord(
                "future-record",
                LocalDate.of(2026, 7, 23),
                future);
        var envelope = new StandardRecordEnvelope<>(
                UUID.randomUUID(),
                1,
                SourceSystem.PMS,
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.of(future),
                Optional.empty(),
                future,
                "record:future-time-0001",
                evidence,
                futureRecord);
        var result = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(envelope),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-20260723T100000Z",
                        CollectionFixtures.NOW)),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(evidence),
                quality(CompletenessState.COMPLETE),
                Optional.empty());

        assertRejected(
                request,
                result,
                CollectionResultRejectionReason.CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
    }

    @Test
    void rejectsEnvelopeObservationThatExceedsItsTrustedParentResult() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var record = validRecord();
        var envelopeObservedAfterResult = new StandardRecordEnvelope<>(
                UUID.randomUUID(),
                1,
                SourceSystem.PMS,
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.of(CollectionFixtures.NOW.minusSeconds(1)),
                Optional.empty(),
                CollectionFixtures.NOW.plusSeconds(1),
                "record:future-envelope-0001",
                evidence,
                record);
        assertRejected(
                request,
                validResult(request, envelopeObservedAfterResult),
                CollectionResultRejectionReason.CONNECTOR_RESULT_TRUSTED_TIME_INVALID);
    }

    @Test
    void rejectsCandidateWatermarkBehindIncludedRecordTime() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var record = new PmsBusinessDateRecord(
                "business-date-2026-07-23",
                LocalDate.of(2026, 7, 23),
                CollectionFixtures.NOW);
        var envelope = validEnvelope(
                request,
                evidence,
                record,
                "record:watermark-behind-0001");
        var result = new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(envelope),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-behind",
                        CollectionFixtures.NOW.minusSeconds(1))),
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(evidence),
                quality(CompletenessState.COMPLETE),
                Optional.empty());

        assertRejected(
                request,
                result,
                CollectionResultRejectionReason.CONNECTOR_RESULT_WATERMARK_INVALID);
    }

    @Test
    void rejectsEnvelopeOutsideClaimedScopeWithFixedCode() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var valid = validEnvelope(request, evidence, validRecord(), "record:key-0001");
        var mismatched = new StandardRecordEnvelope<>(
                valid.recordId(),
                valid.schemaVersion(),
                valid.sourceSystem(),
                UUID.randomUUID(),
                valid.hotelId(),
                valid.connectorId(),
                valid.runId(),
                valid.stream(),
                valid.sourceEffectiveAt(),
                valid.sourceDetectionInterval(),
                valid.observedAt(),
                valid.idempotencyKey(),
                valid.evidence(),
                valid.record());

        assertRejected(
                request,
                validResult(request, mismatched),
                CollectionResultRejectionReason.CONNECTOR_RESULT_ENVELOPE_SCOPE_MISMATCH);
    }

    @Test
    void rejectsEnvelopeFromWrongSourceWithFixedCode() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var valid = validEnvelope(request, evidence, validRecord(), "record:key-0001");
        var mismatched = new StandardRecordEnvelope<>(
                valid.recordId(),
                valid.schemaVersion(),
                SourceSystem.CTRIP,
                valid.tenantId(),
                valid.hotelId(),
                valid.connectorId(),
                valid.runId(),
                valid.stream(),
                valid.sourceEffectiveAt(),
                valid.sourceDetectionInterval(),
                valid.observedAt(),
                valid.idempotencyKey(),
                valid.evidence(),
                valid.record());

        assertRejected(
                request,
                validResult(request, mismatched),
                CollectionResultRejectionReason.CONNECTOR_RESULT_ENVELOPE_SOURCE_MISMATCH);
    }

    @Test
    void rejectsInvalidEvidenceWithFixedCode() {
        var request = CollectionFixtures.request();
        var invalid = new EvidenceReference(
                "https://vendor.example/export",
                "not-a-sha",
                "application/json",
                10);

        assertRejected(
                request,
                validResult(
                        request,
                        validEnvelope(request, invalid, validRecord(), "record:key-0001")),
                CollectionResultRejectionReason.CONNECTOR_RESULT_EVIDENCE_INVALID);
    }

    @Test
    void rejectsHostPathsIdentityMarkersAndCredentialMarkersInEvidence() {
        var request = CollectionFixtures.request();
        for (var reference : List.of(
                "file:///C:/Users/operator/export.json",
                "fixture://operator@example/export.json",
                "object://evidence/secret-token/export.json")) {
            var evidence = new EvidenceReference(
                    reference,
                    SHA,
                    "application/json",
                    10);
            assertRejected(
                    request,
                    validResult(
                            request,
                            validEnvelope(
                                    request,
                                    evidence,
                                    validRecord(),
                                    "record:unsafe-evidence-0001")),
                    CollectionResultRejectionReason.CONNECTOR_RESULT_EVIDENCE_INVALID);
        }
    }

    @Test
    void rejectsUnsafeIdempotencyKeyWithFixedCode() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();

        assertRejected(
                request,
                validResult(
                        request,
                        validEnvelope(request, evidence, validRecord(), "short")),
                CollectionResultRejectionReason.CONNECTOR_RESULT_IDEMPOTENCY_INVALID);
    }

    @Test
    void rejectsUnsafeRecordTypeWithFixedCode() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var record = new BadRecord("source-key", CollectionFixtures.NOW.minusSeconds(1));

        assertRejected(
                request,
                validResult(
                        request,
                        validEnvelope(request, evidence, record, "record:key-0001")),
                CollectionResultRejectionReason.CONNECTOR_RESULT_SCHEMA_INVALID);
    }

    @Test
    void rejectsRecordTypeThatExceedsDatabaseBoundary() {
        var request = CollectionFixtures.request();
        var evidence = validEvidence();
        var record = new LongTypeRecord(
                "source-key",
                CollectionFixtures.NOW.minusSeconds(1));

        assertRejected(
                request,
                validResult(
                        request,
                        validEnvelope(
                                request,
                                evidence,
                                record,
                                "record:long-type-0001")),
                CollectionResultRejectionReason.CONNECTOR_RESULT_SCHEMA_INVALID);
    }

    private void assertRejected(
            CollectionRequest request,
            CollectionResult result,
            CollectionResultRejectionReason expected) {
        var failure = assertThrows(
                CollectionResultValidationException.class,
                () -> validator.validate(
                        request,
                        descriptor,
                        result,
                        CollectionFixtures.NOW));
        assertEquals(expected, failure.reason());
        assertEquals(expected.name(), failure.getMessage());
    }

    private static CollectionResult validResult(
            CollectionRequest request,
            StandardRecordEnvelope<?> envelope) {
        return new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(envelope),
                Optional.of(new CollectionWatermark(
                        "UPDATED_AT",
                        "cursor-20260723T100000Z",
                        CollectionFixtures.NOW.minusSeconds(1))),
                Optional.of(CollectionFixtures.NOW.minusSeconds(1)),
                CollectionFixtures.NOW,
                List.of(envelope.evidence()),
                quality(CompletenessState.COMPLETE),
                Optional.empty());
    }

    private static CollectionResult completeResult(
            Optional<CollectionWatermark> candidate,
            CollectionQuality quality) {
        return new CollectionResult(
                CollectionStatus.SUCCESS,
                List.of(),
                candidate,
                Optional.empty(),
                CollectionFixtures.NOW,
                List.of(),
                quality,
                Optional.empty());
    }

    private static CollectionRequest withCommitted(
            CollectionRequest request,
            CollectionWatermark committed) {
        return new CollectionRequest(
                request.scope(),
                request.connectorId(),
                request.configVersion(),
                request.runId(),
                request.stream(),
                request.trigger(),
                request.window(),
                Optional.of(committed),
                request.businessDayContext(),
                request.cutoffAt(),
                request.timeout(),
                request.traceContext());
    }

    private static <T extends StandardRecord> StandardRecordEnvelope<T> validEnvelope(
            CollectionRequest request,
            EvidenceReference evidence,
            T record,
            String idempotencyKey) {
        return new StandardRecordEnvelope<>(
                UUID.randomUUID(),
                1,
                SourceSystem.PMS,
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.of(CollectionFixtures.NOW.minusSeconds(1)),
                Optional.empty(),
                CollectionFixtures.NOW,
                idempotencyKey,
                evidence,
                record);
    }

    private static PmsBusinessDateRecord validRecord() {
        return new PmsBusinessDateRecord(
                "business-date-2026-07-23",
                LocalDate.of(2026, 7, 23),
                CollectionFixtures.NOW.minusSeconds(1));
    }

    private static EvidenceReference validEvidence() {
        return new EvidenceReference("fixture://sprint2/result-1.json", SHA, "application/json", 10);
    }

    private static CollectionQuality quality(CompletenessState completeness) {
        return quality(
                DataQualityState.FRESH,
                ValidationState.PASS,
                ValidationState.PASS,
                ValidationState.PASS,
                completeness);
    }

    private static CollectionQuality quality(
            DataQualityState dataQuality,
            ValidationState pagination,
            ValidationState field,
            ValidationState capability) {
        return quality(
                dataQuality,
                pagination,
                field,
                capability,
                CompletenessState.COMPLETE);
    }

    private static CollectionQuality quality(
            DataQualityState dataQuality,
            ValidationState pagination,
            ValidationState field,
            ValidationState capability,
            CompletenessState completeness) {
        return new CollectionQuality(
                dataQuality,
                completeness,
                pagination,
                field,
                capability,
                List.of());
    }

    private record BadRecord(String sourceRecordKey, Instant sourceUpdatedAt)
            implements StandardRecord {
        @Override
        public String recordType() {
            return "BAD RECORD TYPE";
        }
    }

    private record LongTypeRecord(
            String sourceRecordKey,
            Instant sourceUpdatedAt) implements StandardRecord {
        @Override
        public String recordType() {
            return "r".repeat(65);
        }
    }
}
