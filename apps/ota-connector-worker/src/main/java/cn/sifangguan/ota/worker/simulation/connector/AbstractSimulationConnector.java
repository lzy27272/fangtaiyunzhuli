package cn.sifangguan.ota.worker.simulation.connector;

import cn.sifangguan.ota.contracts.collection.CollectionQuality;
import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.collection.CollectionWatermark;
import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.SourceDetectionInterval;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.collection.StandardRecordEnvelope;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.CollectionStatus;
import cn.sifangguan.ota.contracts.connector.ConfigValidationResult;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.ConnectionTestResult;
import cn.sifangguan.ota.contracts.connector.ConnectorCapabilityRequirement;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.NonSecretConnectorConfig;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.connector.ValidationIssue;
import cn.sifangguan.ota.contracts.quality.CompletenessState;
import cn.sifangguan.ota.contracts.quality.DataQualityState;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

abstract class AbstractSimulationConnector implements SourceConnector {
    private static final Duration OBSERVATION_OFFSET = Duration.ofSeconds(30);

    private final ConnectorDescriptor descriptor;
    private final Clock clock;

    AbstractSimulationConnector(ConnectorDescriptor descriptor, Clock clock) {
        this.descriptor = Objects.requireNonNull(descriptor, "descriptor");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    @Override
    public final ConnectorDescriptor descriptor() {
        return descriptor;
    }

    @Override
    public final ConfigValidationResult validateConfig(
            NonSecretConnectorConfig config,
            ConnectorCapabilityRequirement requirement) {
        Objects.requireNonNull(config, "config");
        Objects.requireNonNull(requirement, "requirement");
        if (!config.values().isEmpty()) {
            return new ConfigValidationResult(
                    ValidationState.FAIL,
                    List.of(new ValidationIssue(
                            "SIMULATION_CONFIG_FORBIDDEN",
                            "",
                            "simulation connector accepts no endpoint or credential configuration")));
        }
        if (!requirement.isSatisfiedBy(descriptor)) {
            return new ConfigValidationResult(
                    ValidationState.FAIL,
                    List.of(new ValidationIssue(
                            "CAPABILITY_REQUIREMENT_UNSATISFIED",
                            "",
                            "simulation connector does not satisfy the requested capability set")));
        }
        return ConfigValidationResult.pass();
    }

    @Override
    public final ConnectionTestResult testConnection(ConnectionContext context) {
        Objects.requireNonNull(context, "context");
        return new ConnectionTestResult(
                ValidationState.PASS, Instant.now(clock), "SIMULATION_LOCAL_FIXTURE");
    }

    @Override
    public final AuthorizationProbeResult probeAuthorization(ConnectionContext context) {
        Objects.requireNonNull(context, "context");
        return new AuthorizationProbeResult(
                AuthorizationState.AUTHORIZED, Instant.now(clock), "SIMULATION_NO_AUTH");
    }

    @Override
    public final CollectionResult collect(CollectionRequest request) {
        Objects.requireNonNull(request, "request");
        if (!descriptor.streams().contains(request.stream())) {
            throw new IllegalArgumentException("unsupported simulation stream: " + request.stream());
        }

        var rawRecords = BuiltInSimulationFixture.records(
                descriptor.sourceSystem(), request.stream());
        var records = new java.util.ArrayList<StandardRecordEnvelope<?>>();
        for (var value : rawRecords) {
            var record = (StandardRecord) value;
            if (record.sourceUpdatedAt().isAfter(request.window().fromExclusive())
                    && !record.sourceUpdatedAt().isAfter(
                            request.window().toInclusive())) {
                records.add(envelope(request, record));
            }
        }
        var observedAt = observationTime(descriptor.sourceSystem(), request.cutoffAt());
        var evidence = records.stream()
                .map(StandardRecordEnvelope::evidence)
                .distinct()
                .toList();
        var quality = new CollectionQuality(
                DataQualityState.FRESH,
                CompletenessState.COMPLETE,
                ValidationState.PASS,
                ValidationState.PASS,
                ValidationState.PASS,
                List.of());
        return new CollectionResult(
                CollectionStatus.SUCCESS,
                records,
                Optional.of(new CollectionWatermark(
                        "SIMULATION_CUTOFF",
                        request.cutoffAt().toString(),
                        request.cutoffAt())),
                Optional.of(request.cutoffAt()),
                observedAt,
                evidence,
                quality,
                Optional.empty());
    }

    private StandardRecordEnvelope<StandardRecord> envelope(
            CollectionRequest request,
            StandardRecord record) {
        var identity = request.scope().tenantId() + "|"
                + request.scope().hotelId() + "|"
                + descriptor.sourceSystem() + "|"
                + request.stream() + "|"
                + record.sourceRecordKey();
        var observedAt = record.sourceUpdatedAt().plus(OBSERVATION_OFFSET);
        if (observedAt.isAfter(observationTime(
                descriptor.sourceSystem(), request.cutoffAt()))) {
            observedAt = observationTime(descriptor.sourceSystem(), request.cutoffAt());
        }
        var evidenceBytes = ("SAFE_SIMULATION_FIXTURE|" + identity)
                .getBytes(StandardCharsets.UTF_8);
        var evidence = new EvidenceReference(
                "fixture://sprint1/" + sha256(identity).substring(0, 16),
                sha256(evidenceBytes),
                "application/vnd.sifangguan.simulation+text",
                evidenceBytes.length);
        return new StandardRecordEnvelope<>(
                UUID.nameUUIDFromBytes(identity.getBytes(StandardCharsets.UTF_8)),
                1,
                descriptor.sourceSystem(),
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                request.runId(),
                request.stream(),
                Optional.empty(),
                Optional.of(new SourceDetectionInterval(
                        record.sourceUpdatedAt().minusSeconds(1),
                        record.sourceUpdatedAt())),
                observedAt,
                "simulation:" + sha256(identity),
                evidence,
                record);
    }

    private static Instant observationTime(SourceSystem source, Instant cutoff) {
        return switch (source) {
            case PMS -> cutoff.plusSeconds(30);
            case CTRIP -> cutoff.plusSeconds(45);
            case MEITUAN -> cutoff.plusSeconds(60);
            default -> cutoff.plusSeconds(30);
        };
    }

    private static String sha256(String text) {
        return sha256(text.getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
