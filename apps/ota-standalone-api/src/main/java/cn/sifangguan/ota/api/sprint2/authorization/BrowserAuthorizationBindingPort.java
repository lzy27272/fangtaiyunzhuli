package cn.sifangguan.ota.api.sprint2.authorization;

import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.OpaqueInteractionReference;

/**
 * Server-side binding boundary for an interactive authorization attempt.
 *
 * <p>The standalone API deliberately provides no production implementation.
 * A future adapter must make {@link #register(BrowserAuthorizationBinding)}
 * duplicate-safe and {@link #revoke(BrowserAuthorizationBinding, Instant)}
 * an atomic compare-and-set transition.</p>
 */
public interface BrowserAuthorizationBindingPort {

    void register(BrowserAuthorizationBinding binding);

    Optional<BrowserAuthorizationBinding> find(UUID authorizationAttemptId);

    BrowserAuthorizationBinding revoke(
            BrowserAuthorizationBinding expectedActiveBinding,
            Instant revokedAt);

    enum BindingLifecycle {
        ACTIVE,
        REVOKED
    }

    record BrowserAuthorizationBinding(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            long configVersion,
            String connectorCode,
            String adapterVersion,
            SourceSystem sourceSystem,
            UUID actorAccountId,
            UUID authorizationAttemptId,
            OpaqueInteractionReference interactionReference,
            Instant expiresAt,
            BindingLifecycle lifecycle
    ) {
        private static final Pattern CONNECTOR_CODE =
                Pattern.compile("[A-Z0-9][A-Z0-9._-]{2,63}");
        private static final Pattern ADAPTER_VERSION =
                Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,63}");

        public BrowserAuthorizationBinding {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            connectorCode = Objects.requireNonNull(
                    connectorCode,
                    "connectorCode");
            adapterVersion = Objects.requireNonNull(
                    adapterVersion,
                    "adapterVersion");
            Objects.requireNonNull(sourceSystem, "sourceSystem");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(
                    interactionReference,
                    "interactionReference");
            Objects.requireNonNull(expiresAt, "expiresAt");
            Objects.requireNonNull(lifecycle, "lifecycle");
            if (configVersion < 1) {
                throw new IllegalArgumentException(
                        "configVersion must be positive");
            }
            if (!CONNECTOR_CODE.matcher(connectorCode).matches()) {
                throw new IllegalArgumentException(
                        "connectorCode must be a safe control-plane code");
            }
            if (!ADAPTER_VERSION.matcher(adapterVersion).matches()) {
                throw new IllegalArgumentException(
                        "adapterVersion must be a safe control-plane version");
            }
        }

        public BrowserAuthorizationBinding revoked() {
            if (lifecycle == BindingLifecycle.REVOKED) {
                return this;
            }
            return new BrowserAuthorizationBinding(
                    tenantId,
                    hotelId,
                    connectorId,
                    configVersion,
                    connectorCode,
                    adapterVersion,
                    sourceSystem,
                    actorAccountId,
                    authorizationAttemptId,
                    interactionReference,
                    expiresAt,
                    BindingLifecycle.REVOKED);
        }
    }
}
