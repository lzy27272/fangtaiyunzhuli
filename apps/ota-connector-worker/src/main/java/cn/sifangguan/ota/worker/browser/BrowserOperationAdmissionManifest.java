package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.connector.DataStreamType;

import java.util.Collection;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Immutable, offline snapshot of browser operations approved by a trusted
 * control-plane source.
 *
 * <p>Entries must be loaded independently of a collection command. Building an
 * entry from fields supplied by the command would remove the trust boundary.
 * This class performs no persistence, network, browser or secret access.</p>
 */
public final class BrowserOperationAdmissionManifest {
    private final Set<Entry> entries;

    private BrowserOperationAdmissionManifest(Collection<Entry> trustedEntries) {
        entries = Set.copyOf(Objects.requireNonNull(
                trustedEntries,
                "trustedEntries"));
    }

    static BrowserOperationAdmissionManifest load(
            TrustedManifestSource trustedSource) {
        Objects.requireNonNull(trustedSource, "trustedSource");
        return new BrowserOperationAdmissionManifest(
                Objects.requireNonNull(
                        trustedSource.loadTrustedEntries(),
                        "trusted manifest entries"));
    }

    boolean admits(BrowserSessionCollectionCommand command) {
        Objects.requireNonNull(command, "command");
        var request = command.request();
        var reference = command.sessionReference();
        return entries.contains(new Entry(
                request.scope().tenantId(),
                request.scope().hotelId(),
                command.actorAccountId(),
                command.authorizationAttemptId(),
                request.connectorId(),
                request.configVersion(),
                command.connectorVersionId(),
                command.connectorCode(),
                command.adapterVersion(),
                request.stream(),
                command.secretProviderCode(),
                command.approvedOperationCode(),
                reference.opaqueRef(),
                command.secretBindingVersion()));
    }

    /**
     * Exact admission identity. The opaque reference is not credential
     * material, but it is redacted from {@link #toString()} to avoid accidental
     * metadata disclosure.
     */
    record Entry(
            UUID tenantId,
            UUID hotelId,
            UUID actorAccountId,
            UUID authorizationAttemptId,
            UUID connectorId,
            long configVersion,
            UUID connectorVersionId,
            String connectorCode,
            String adapterVersion,
            DataStreamType stream,
            String secretProviderCode,
            String operationCode,
            String sessionOpaqueReference,
            long secretBindingVersion) {

        Entry {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(connectorId, "connectorId");
            if (configVersion < 1) {
                throw new IllegalArgumentException("configVersion must be positive");
            }
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            connectorCode = BrowserSessionCollectionCommand.requireSafeCode(
                    connectorCode,
                    "connectorCode");
            adapterVersion = BrowserSessionCollectionCommand.requireSafeVersion(
                    adapterVersion);
            Objects.requireNonNull(stream, "stream");
            secretProviderCode = BrowserSessionCollectionCommand.requireSafeCode(
                    secretProviderCode,
                    "secretProviderCode");
            operationCode = BrowserSessionCollectionCommand.requireSafeCode(
                    operationCode,
                    "operationCode");
            BrowserSessionCollectionCommand.validateSecretProviderReference(
                    secretProviderCode,
                    sessionOpaqueReference);
            if (secretBindingVersion < 1) {
                throw new IllegalArgumentException(
                        "secretBindingVersion must be positive");
            }
        }

        @Override
        public String toString() {
            return "Entry[scope=<redacted>"
                    + ", actorAccountId=<redacted>"
                    + ", authorizationAttemptId=<redacted>"
                    + ", connectorId=<redacted>"
                    + ", configVersion=" + configVersion
                    + ", connectorVersionId=<redacted>"
                    + ", connectorCode=" + connectorCode
                    + ", adapterVersion=" + adapterVersion
                    + ", stream=" + stream
                    + ", secretProviderCode=" + secretProviderCode
                    + ", operationCode=" + operationCode
                    + ", sessionOpaqueReference=<redacted>"
                    + ", secretBindingVersion=" + secretBindingVersion
                    + "]";
        }
    }

    /**
     * Package-private capability implemented only by a reviewed loader in this
     * bridge package. There is intentionally no production implementation or
     * wiring in the offline Worker.
     */
    @FunctionalInterface
    interface TrustedManifestSource {
        Collection<Entry> loadTrustedEntries();
    }
}
