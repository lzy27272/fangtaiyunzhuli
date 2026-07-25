package cn.sifangguan.ota.api.sprint2.intake;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class Sprint2ConnectorIntakeModels {
    private Sprint2ConnectorIntakeModels() {
    }

    public enum SourceCode {
        PMS,
        CTRIP,
        MEITUAN
    }

    public enum BlockedAction {
        TEST_CONNECTION,
        ACTIVATE,
        RUN
    }

    public record IntakeTemplate(
            String templateCode,
            SourceCode sourceCode,
            String displayName,
            String implementationStatus,
            List<String> connectionMethods,
            List<Integer> allowedPollIntervalsMinutes,
            List<String> acceptedFields,
            boolean executable
    ) {
        public IntakeTemplate {
            templateCode = requireText(templateCode, "templateCode");
            Objects.requireNonNull(sourceCode, "sourceCode");
            displayName = requireText(displayName, "displayName");
            implementationStatus = requireText(
                    implementationStatus,
                    "implementationStatus");
            connectionMethods = List.copyOf(
                    Objects.requireNonNull(connectionMethods, "connectionMethods"));
            allowedPollIntervalsMinutes = List.copyOf(
                    Objects.requireNonNull(
                            allowedPollIntervalsMinutes,
                            "allowedPollIntervalsMinutes"));
            acceptedFields = List.copyOf(
                    Objects.requireNonNull(acceptedFields, "acceptedFields"));
            if (connectionMethods.isEmpty()
                    || allowedPollIntervalsMinutes.isEmpty()
                    || acceptedFields.isEmpty()) {
                throw new IllegalArgumentException(
                        "Template methods, intervals and fields must not be empty");
            }
            if (executable) {
                throw new IllegalArgumentException(
                        "Sprint 2 intake templates must remain non-executable");
            }
        }
    }

    /**
     * Deliberately excludes provider references and secret material.
     */
    public record SecretBindingStatus(
            String purpose,
            String providerCode,
            boolean configured,
            String status
    ) {
        public SecretBindingStatus {
            purpose = requireText(purpose, "purpose");
            providerCode = requireText(providerCode, "providerCode");
            status = requireText(status, "status");
        }
    }

    public record ConnectorDraftView(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            SourceCode sourceCode,
            String templateCode,
            String vendorCode,
            String vendorName,
            String productName,
            String productVersion,
            String connectionMethod,
            String externalHotelCode,
            String accountAlias,
            String networkRouteCode,
            int pollIntervalMinutes,
            List<SecretBindingStatus> secretBindings,
            long rowVersion,
            String lifecycle,
            String readinessCode,
            boolean runtimeBlocked,
            List<String> blockers
    ) {
        public ConnectorDraftView {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(sourceCode, "sourceCode");
            templateCode = requireText(templateCode, "templateCode");
            vendorCode = requireText(vendorCode, "vendorCode");
            vendorName = requireText(vendorName, "vendorName");
            productName = requireText(productName, "productName");
            connectionMethod = requireText(connectionMethod, "connectionMethod");
            externalHotelCode = requireText(externalHotelCode, "externalHotelCode");
            networkRouteCode = requireText(networkRouteCode, "networkRouteCode");
            secretBindings = List.copyOf(
                    Objects.requireNonNull(secretBindings, "secretBindings"));
            lifecycle = requireText(lifecycle, "lifecycle");
            readinessCode = requireText(readinessCode, "readinessCode");
            blockers = List.copyOf(Objects.requireNonNull(blockers, "blockers"));
            if (!"DRAFT".equals(lifecycle)) {
                throw new IllegalArgumentException(
                        "Sprint 2 intake lifecycle must be DRAFT");
            }
            if (rowVersion < 0) {
                throw new IllegalArgumentException("rowVersion must not be negative");
            }
            if (!runtimeBlocked) {
                throw new IllegalArgumentException(
                        "Sprint 2 connector intake runtime must remain blocked");
            }
        }
    }

    public record SecretBindingInput(
            String purpose,
            String providerCode,
            String opaqueSecretReference,
            String secretVersion
    ) {
        public SecretBindingInput {
            purpose = requireText(purpose, "purpose");
            providerCode = requireText(providerCode, "providerCode");
            opaqueSecretReference = requireText(
                    opaqueSecretReference,
                    "opaqueSecretReference");
            secretVersion = requireText(secretVersion, "secretVersion");
        }
    }

    public record SaveDraftCommand(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID actorAccountId,
            SourceCode sourceCode,
            String templateCode,
            String vendorCode,
            String vendorName,
            String productName,
            String productVersion,
            String connectionMethod,
            String externalHotelCode,
            String accountAlias,
            String networkRouteCode,
            int pollIntervalMinutes,
            List<SecretBindingInput> secretBindings,
            long expectedRowVersion,
            String idempotencyKey,
            String reasonCode,
            String requestHash
    ) {
        public SaveDraftCommand {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(sourceCode, "sourceCode");
            templateCode = requireText(templateCode, "templateCode");
            vendorCode = requireText(vendorCode, "vendorCode");
            vendorName = requireText(vendorName, "vendorName");
            productName = requireText(productName, "productName");
            connectionMethod = requireText(connectionMethod, "connectionMethod");
            externalHotelCode = requireText(externalHotelCode, "externalHotelCode");
            networkRouteCode = requireText(networkRouteCode, "networkRouteCode");
            secretBindings = List.copyOf(
                    Objects.requireNonNull(secretBindings, "secretBindings"));
            idempotencyKey = requireText(idempotencyKey, "idempotencyKey");
            reasonCode = requireText(reasonCode, "reasonCode");
            requestHash = requireText(requestHash, "requestHash");
            if (expectedRowVersion < 0) {
                throw new IllegalArgumentException(
                        "expectedRowVersion must not be negative");
            }
        }
    }

    public record CommandReceipt(
            String commandId,
            UUID resourceId,
            long resultingRowVersion,
            boolean replayed
    ) {
        public CommandReceipt {
            commandId = requireText(commandId, "commandId");
            Objects.requireNonNull(resourceId, "resourceId");
            if (resultingRowVersion < 0) {
                throw new IllegalArgumentException(
                        "resultingRowVersion must not be negative");
            }
        }
    }

    public record Envelope<T>(T data) {
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
