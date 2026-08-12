package cn.sifangguan.ota.api.sprint2.migration;

import java.util.Objects;
import java.util.UUID;

public final class CredentialMigrationModels {
    private CredentialMigrationModels() {
    }

    public record PrepareCommand(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            UUID actorAccountId,
            long expectedBindingRowVersion,
            String secretPurpose,
            String sourceSystemCode,
            String sourceLocatorHash,
            String targetProviderCode,
            String targetSecretVersion,
            String targetSecretFingerprint,
            String reasonCode,
            String idempotencyKey,
            String requestHash
    ) {
        public PrepareCommand {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            requireText(secretPurpose, "secretPurpose");
            requireText(sourceSystemCode, "sourceSystemCode");
            requireText(sourceLocatorHash, "sourceLocatorHash");
            requireText(targetProviderCode, "targetProviderCode");
            requireText(targetSecretVersion, "targetSecretVersion");
            requireText(targetSecretFingerprint, "targetSecretFingerprint");
            requireText(reasonCode, "reasonCode");
            requireText(idempotencyKey, "idempotencyKey");
            requireText(requestHash, "requestHash");
            if (expectedBindingRowVersion < 0) {
                throw new IllegalArgumentException(
                        "expectedBindingRowVersion must not be negative");
            }
        }
    }

    /**
     * Deliberately excludes SecretStore references and all secret material.
     */
    public record RehearsalView(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            UUID rehearsalId,
            String secretPurpose,
            String sourceSystemCode,
            String sourceLocatorHash,
            String targetProviderCode,
            String targetSecretVersion,
            String targetSecretFingerprint,
            String state,
            boolean executionAllowed,
            long rowVersion
    ) {
        public RehearsalView {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            Objects.requireNonNull(rehearsalId, "rehearsalId");
            requireText(secretPurpose, "secretPurpose");
            requireText(sourceSystemCode, "sourceSystemCode");
            requireText(sourceLocatorHash, "sourceLocatorHash");
            requireText(targetProviderCode, "targetProviderCode");
            requireText(targetSecretVersion, "targetSecretVersion");
            requireText(targetSecretFingerprint, "targetSecretFingerprint");
            requireText(state, "state");
            if (!"METADATA_REHEARSAL_READY".equals(state)) {
                throw new IllegalArgumentException(
                        "WP2 rehearsal must remain metadata-only");
            }
            if (executionAllowed) {
                throw new IllegalArgumentException(
                        "WP2 rehearsal must not permit execution");
            }
            if (rowVersion != 0) {
                throw new IllegalArgumentException(
                        "WP2 rehearsal is append-only at version zero");
            }
        }
    }

    public record Receipt(
            String commandId,
            UUID rehearsalId,
            boolean replayed
    ) {
        public Receipt {
            requireText(commandId, "commandId");
            Objects.requireNonNull(rehearsalId, "rehearsalId");
        }
    }

    public record Envelope<T>(T data) {
    }

    private static void requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }
}
