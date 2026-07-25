package cn.sifangguan.ota.worker.filefixture;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.ConfigValidationResult;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.ConnectionTestResult;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorCapabilityRequirement;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.ExportParseRequest;
import cn.sifangguan.ota.contracts.connector.NonSecretConnectorConfig;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.connector.ValidationIssue;
import cn.sifangguan.ota.contracts.quality.ValidationState;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * Executable FILE_FIXTURE adapter for Sprint 1.
 *
 * <p>It only reads a compiled-in synthetic fixture. It accepts no endpoint,
 * host path or credential and has no network client.</p>
 */
@Component
public final class FileFixtureConnector implements SourceConnector {
    public static final String CONNECTOR_CODE = "FILE_FIXTURE";
    public static final String PARSER_VERSION = "1.0.0";

    static final Set<DataStreamType> STREAMS = Set.of(
            DataStreamType.BUSINESS_DATE,
            DataStreamType.BOOKING_EVENT,
            DataStreamType.CANCELLATION_EVENT,
            DataStreamType.INVENTORY_ROOM_TYPE,
            DataStreamType.INVENTORY_SELL_PRODUCT,
            DataStreamType.ROOM_REVENUE_AGGREGATE);
    private static final Set<String> SAFE_CONFIG_FIELDS = Set.of(
            "fixtureScenarioCode",
            "pollIntervalMinutes");

    private static final ConnectorDescriptor DESCRIPTOR =
            new ConnectorDescriptor(
                    CONNECTOR_CODE,
                    SourceSystem.OFFICIAL_EXPORT,
                    PARSER_VERSION,
                    Set.of(ConnectorCapability.OFFICIAL_EXPORT_PARSE),
                    STREAMS,
                    false);

    private final Clock clock;
    private final BuiltInOfficialExportParser parser;

    public FileFixtureConnector(
            @Qualifier("utcClock") Clock clock,
            BuiltInOfficialExportParser parser) {
        this.clock = Objects.requireNonNull(clock, "clock");
        this.parser = Objects.requireNonNull(parser, "parser");
    }

    @Override
    public ConnectorDescriptor descriptor() {
        return DESCRIPTOR;
    }

    @Override
    public ConfigValidationResult validateConfig(
            NonSecretConnectorConfig config,
            ConnectorCapabilityRequirement requirement) {
        Objects.requireNonNull(config, "config");
        Objects.requireNonNull(requirement, "requirement");
        if (!SAFE_CONFIG_FIELDS.containsAll(config.values().keySet())) {
            return failConfig(
                    "FILE_FIXTURE_CONFIG_FORBIDDEN",
                    "FILE_FIXTURE accepts no endpoint, path, or credential configuration");
        }
        var scenario = config.values().get("fixtureScenarioCode");
        if (scenario != null && !"BASELINE".equals(scenario)) {
            return failConfig(
                    "FILE_FIXTURE_SCENARIO_UNSUPPORTED",
                    "FILE_FIXTURE currently supports only the BASELINE fixture");
        }
        var interval = config.values().get("pollIntervalMinutes");
        if (interval != null && !validPollInterval(interval)) {
            return failConfig(
                    "FILE_FIXTURE_POLL_INTERVAL_INVALID",
                    "pollIntervalMinutes must be an integer between 5 and 60");
        }
        if (!requirement.isSatisfiedBy(DESCRIPTOR)) {
            return failConfig(
                    "CAPABILITY_REQUIREMENT_UNSATISFIED",
                    "FILE_FIXTURE does not satisfy the requested capability set");
        }
        return ConfigValidationResult.pass();
    }

    @Override
    public ConnectionTestResult testConnection(ConnectionContext context) {
        Objects.requireNonNull(context, "context");
        return new ConnectionTestResult(
                ValidationState.PASS,
                Instant.now(clock),
                "BUILT_IN_FILE_FIXTURE_AVAILABLE");
    }

    @Override
    public AuthorizationProbeResult probeAuthorization(ConnectionContext context) {
        Objects.requireNonNull(context, "context");
        return new AuthorizationProbeResult(
                AuthorizationState.AUTHORIZED,
                Instant.now(clock),
                "FILE_FIXTURE_AUTH_NOT_REQUIRED");
    }

    @Override
    public CollectionResult collect(CollectionRequest request) {
        Objects.requireNonNull(request, "request");
        return parser.parse(new ExportParseRequest(
                BuiltInOfficialExportFixture.fileContext(
                        request.scope(), request.runId()),
                request));
    }

    private static ConfigValidationResult failConfig(
            String code,
            String message) {
        return new ConfigValidationResult(
                ValidationState.FAIL,
                List.of(new ValidationIssue(code, "", message)));
    }

    private static boolean validPollInterval(String value) {
        try {
            var minutes = Integer.parseInt(value);
            return minutes >= 5 && minutes <= 60;
        } catch (NumberFormatException ignored) {
            return false;
        }
    }
}
