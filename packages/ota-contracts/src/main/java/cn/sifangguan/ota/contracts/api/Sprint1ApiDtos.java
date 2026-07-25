package cn.sifangguan.ota.contracts.api;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Transport-only Sprint 1 DTOs shared by generated clients and contract tests.
 * Raw credentials and endpoint secrets are deliberately absent from response DTOs.
 */
public final class Sprint1ApiDtos {
    private Sprint1ApiDtos() {
    }

    public record DataEnvelope<T>(T data) {
        public DataEnvelope {
            Objects.requireNonNull(data, "data");
        }
    }

    public record CommandReceipt(
            String commandId,
            UUID resourceId,
            long resultingRowVersion,
            boolean replayed) {
        public CommandReceipt {
            commandId = requireText(commandId, "commandId");
            Objects.requireNonNull(resourceId, "resourceId");
            if (resultingRowVersion < 0) {
                throw new IllegalArgumentException(
                        "resultingRowVersion must not be negative");
            }
        }
    }

    public enum AdapterCode {
        MOCK_PMS,
        MOCK_CTRIP,
        MOCK_MEITUAN,
        FILE_FIXTURE
    }

    public enum SourceCode {
        PMS,
        CTRIP,
        MEITUAN,
        OFFICIAL_EXPORT
    }

    public enum SimulationScenarioCode {
        BASELINE,
        INVENTORY_MISMATCH,
        SOURCE_UNAVAILABLE,
        LATE_BRIEF_REPLAY
    }

    public record CommandFields(long expectedRowVersion, String reasonCode) {
        public CommandFields {
            if (expectedRowVersion < 0) {
                throw new IllegalArgumentException(
                        "expectedRowVersion must not be negative");
            }
            reasonCode = requireText(reasonCode, "reasonCode");
        }
    }

    public record ConnectorRequest(
            long expectedRowVersion,
            String reasonCode,
            AdapterCode adapterCode,
            SourceCode sourceCode,
            boolean enabled,
            String fixtureScenarioCode,
            int pollIntervalMinutes,
            Optional<String> secretReference) {
        public ConnectorRequest {
            if (expectedRowVersion < 0) {
                throw new IllegalArgumentException(
                        "expectedRowVersion must not be negative");
            }
            reasonCode = requireText(reasonCode, "reasonCode");
            Objects.requireNonNull(adapterCode, "adapterCode");
            Objects.requireNonNull(sourceCode, "sourceCode");
            fixtureScenarioCode = requireText(
                    fixtureScenarioCode, "fixtureScenarioCode");
            secretReference = Objects.requireNonNull(
                    secretReference, "secretReference");
            if (adapterCode == AdapterCode.FILE_FIXTURE
                    && sourceCode != SourceCode.OFFICIAL_EXPORT) {
                throw new IllegalArgumentException(
                        "FILE_FIXTURE requires OFFICIAL_EXPORT");
            }
            if (adapterCode == AdapterCode.FILE_FIXTURE
                    && secretReference.isPresent()) {
                throw new IllegalArgumentException(
                        "FILE_FIXTURE does not accept a secretReference");
            }
            if (pollIntervalMinutes < 5 || pollIntervalMinutes > 60) {
                throw new IllegalArgumentException(
                        "pollIntervalMinutes must be within [5,60]");
            }
        }
    }

    public record SimulationRunRequest(
            CommandFields command,
            SimulationScenarioCode scenarioCode) {
        public SimulationRunRequest {
            Objects.requireNonNull(command, "command");
            Objects.requireNonNull(scenarioCode, "scenarioCode");
            if (command.expectedRowVersion() != 0) {
                throw new IllegalArgumentException(
                        "new simulation run requires expectedRowVersion=0");
            }
        }
    }

    public record SimulationRunView(
            UUID runId,
            SimulationScenarioCode scenarioCode,
            String status,
            Instant fixedClockAt,
            Instant scheduledFor,
            Optional<Instant> startedAt,
            Optional<Instant> completedAt,
            Optional<UUID> briefId,
            List<UUID> incidentIds,
            long rowVersion) {
        public SimulationRunView {
            Objects.requireNonNull(runId, "runId");
            Objects.requireNonNull(scenarioCode, "scenarioCode");
            status = requireText(status, "status");
            Objects.requireNonNull(fixedClockAt, "fixedClockAt");
            Objects.requireNonNull(scheduledFor, "scheduledFor");
            startedAt = Objects.requireNonNull(startedAt, "startedAt");
            completedAt = Objects.requireNonNull(completedAt, "completedAt");
            briefId = Objects.requireNonNull(briefId, "briefId");
            incidentIds = List.copyOf(incidentIds);
            if (rowVersion < 0) {
                throw new IllegalArgumentException(
                        "rowVersion must not be negative");
            }
        }
    }

    public record SecretStatus(
            boolean configured,
            Optional<String> fingerprint,
            String authorizationStatus,
            Optional<Instant> lastCheckedAt) {
        public SecretStatus {
            fingerprint = Objects.requireNonNull(fingerprint, "fingerprint");
            authorizationStatus = requireText(
                    authorizationStatus, "authorizationStatus");
            lastCheckedAt = Objects.requireNonNull(
                    lastCheckedAt, "lastCheckedAt");
            if (!configured && fingerprint.isPresent()) {
                throw new IllegalArgumentException(
                        "unconfigured secret must not expose a fingerprint");
            }
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
