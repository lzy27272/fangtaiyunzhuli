package cn.sifangguan.ota.worker.filefixture;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.ConnectorError;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ExportDescriptor;
import cn.sifangguan.ota.contracts.connector.ExportFileContext;
import cn.sifangguan.ota.contracts.connector.ExportParseRequest;
import cn.sifangguan.ota.contracts.connector.ExportValidationResult;
import cn.sifangguan.ota.contracts.connector.OfficialExportParser;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.connector.ValidationIssue;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * OfficialExportParser implementation backed exclusively by the immutable
 * built-in Sprint 1 fixture.
 */
@Component
public final class BuiltInOfficialExportParser implements OfficialExportParser {
    private static final ExportDescriptor DESCRIPTOR = new ExportDescriptor(
            FileFixtureConnector.CONNECTOR_CODE,
            SourceSystem.OFFICIAL_EXPORT,
            FileFixtureConnector.PARSER_VERSION,
            Set.of(BuiltInOfficialExportFixture.MEDIA_TYPE));

    private final Clock clock;

    public BuiltInOfficialExportParser(
            @Qualifier("utcClock") Clock clock) {
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    @Override
    public ExportDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    public ExportValidationResult validate(ExportFileContext file) {
        Objects.requireNonNull(file, "file");
        if (!BuiltInOfficialExportFixture.isAvailable(
                file.evidenceReference())) {
            return new ExportValidationResult(
                    ValidationState.FAIL,
                    List.of(new ValidationIssue(
                            "FILE_FIXTURE_SOURCE_UNAVAILABLE",
                            "",
                            "the requested built-in official export fixture is unavailable")));
        }
        return new ExportValidationResult(ValidationState.PASS, List.of());
    }

    @Override
    public CollectionResult parse(ExportParseRequest parseRequest) {
        Objects.requireNonNull(parseRequest, "parseRequest");
        var request = parseRequest.collectionRequest();
        if (!parseRequest.file().scope().equals(request.scope())) {
            return unavailable(request, "FILE_FIXTURE_SCOPE_MISMATCH");
        }
        if (validate(parseRequest.file()).state() != ValidationState.PASS) {
            return unavailable(request, "FILE_FIXTURE_SOURCE_UNAVAILABLE");
        }
        if (!FileFixtureConnector.STREAMS.contains(request.stream())) {
            return unavailable(request, "FILE_FIXTURE_STREAM_UNAVAILABLE");
        }

        var observedAt = observationTime(request);
        var records = new ArrayList<StandardRecordEnvelope<?>>();
        for (var record : BuiltInOfficialExportFixture.records(
                request.stream())) {
            if (record.sourceUpdatedAt().isAfter(
                    request.window().fromExclusive())
                    && !record.sourceUpdatedAt().isAfter(
                            request.window().toInclusive())) {
                records.add(envelope(
                        request,
                        parseRequest.file().evidenceReference(),
                        record,
                        observedAt));
            }
        }

        return new CollectionResult(
                CollectionStatus.SUCCESS,
                records,
                Optional.of(new CollectionWatermark(
                        "OFFICIAL_EXPORT_CUTOFF",
                        request.cutoffAt().toString(),
                        request.cutoffAt())),
                Optional.of(request.cutoffAt()),
                observedAt,
                List.of(parseRequest.file().evidenceReference()),
                completeQuality(),
                Optional.empty());
    }

    private StandardRecordEnvelope<StandardRecord> envelope(
            CollectionRequest request,
            EvidenceReference evidence,
            StandardRecord record,
            Instant observedAt) {
        var identity = request.scope().tenantId() + "|"
                + request.scope().hotelId() + "|"
                + request.connectorId() + "|"
                + request.stream() + "|"
                + record.sourceRecordKey();
        return new StandardRecordEnvelope<>(
                UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8)),
                1,
                SourceSystem.OFFICIAL_EXPORT,
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.of(record.sourceUpdatedAt()),
                Optional.empty(),
                observedAt,
                "official-export:" + sha256(identity),
                evidence,
                record);
    }

    private CollectionResult unavailable(
            CollectionRequest request,
            String failureCode) {
        return new CollectionResult(
                CollectionStatus.FAILED,
                List.of(),
                Optional.empty(),
                Optional.empty(),
                observationTime(request),
                List.of(),
                new CollectionQuality(
                        DataQualityState.UNAVAILABLE,
                        CompletenessState.UNAVAILABLE,
                        ValidationState.FAIL,
                        ValidationState.FAIL,
                        ValidationState.FAIL,
                        List.of(new ValidationIssue(
                                failureCode,
                                "",
                                "official export fixture data is unavailable"))),
                Optional.of(new ConnectorError(
                        failureCode,
                        false,
                        "official export fixture data is unavailable")));
    }

    private Instant observationTime(CollectionRequest request) {
        var now = Instant.now(clock);
        return now.isBefore(request.cutoffAt()) ? request.cutoffAt() : now;
    }

    private static CollectionQuality completeQuality() {
        return new CollectionQuality(
                DataQualityState.FRESH,
                CompletenessState.COMPLETE,
                ValidationState.PASS,
                ValidationState.PASS,
                ValidationState.PASS,
                List.of());
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
