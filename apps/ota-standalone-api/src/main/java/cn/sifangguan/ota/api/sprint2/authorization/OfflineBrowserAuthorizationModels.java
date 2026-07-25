package cn.sifangguan.ota.api.sprint2.authorization;

import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.authorization.BrowserAuthorizationBindingPort.BrowserAuthorizationBinding;

/**
 * Secret-free control-plane views for an interactive browser authorization.
 */
public final class OfflineBrowserAuthorizationModels {
    private OfflineBrowserAuthorizationModels() {
    }

    public enum StatusCode {
        BROWSER_SESSION_AUTHORIZED,
        BROWSER_SESSION_AUTH_REQUIRED,
        BROWSER_SESSION_PENDING_INTERACTION,
        BROWSER_SESSION_REVOKED,
        BROWSER_SESSION_UNKNOWN
    }

    /**
     * Complete safe projection of the server-side authorization binding.
     */
    public record AuthorizationScopeView(
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
            Instant expiresAt
    ) {
        private static final Pattern CONNECTOR_CODE =
                Pattern.compile("[A-Z0-9][A-Z0-9._-]{2,63}");
        private static final Pattern ADAPTER_VERSION =
                Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,63}");

        public AuthorizationScopeView {
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

        static AuthorizationScopeView from(
                BrowserAuthorizationBinding binding
        ) {
            Objects.requireNonNull(binding, "binding");
            return new AuthorizationScopeView(
                    binding.tenantId(),
                    binding.hotelId(),
                    binding.connectorId(),
                    binding.configVersion(),
                    binding.connectorCode(),
                    binding.adapterVersion(),
                    binding.sourceSystem(),
                    binding.actorAccountId(),
                    binding.authorizationAttemptId(),
                    binding.interactionReference(),
                    binding.expiresAt());
        }
    }

    public record OpaqueInteractionReference(String value) {
        private static final Pattern FORMAT = Pattern.compile(
                "urn:sifangguan:browser-auth:[A-Za-z0-9][A-Za-z0-9_-]{15,127}");

        public OpaqueInteractionReference {
            value = Objects.requireNonNull(value, "value");
            if (!FORMAT.matcher(value).matches()) {
                throw new IllegalArgumentException(
                        "interactionReference must be an opaque browser authorization handle");
            }
        }
    }

    public record StartView(
            AuthorizationScopeView scope,
            AuthorizationState state,
            StatusCode statusCode
    ) {
        public StartView {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(statusCode, "statusCode");
            requireMatchingStatus(state, statusCode);
        }
    }

    public record ProbeView(
            AuthorizationScopeView scope,
            AuthorizationState state,
            StatusCode statusCode,
            Instant observedAt
    ) {
        public ProbeView {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(statusCode, "statusCode");
            Objects.requireNonNull(observedAt, "observedAt");
            requireMatchingStatus(state, statusCode);
        }
    }

    public record RevokeView(
            AuthorizationScopeView scope,
            AuthorizationState state,
            StatusCode statusCode,
            Instant observedAt
    ) {
        public RevokeView {
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(statusCode, "statusCode");
            Objects.requireNonNull(observedAt, "observedAt");
            if (state != AuthorizationState.REVOKED
                    || statusCode != StatusCode.BROWSER_SESSION_REVOKED) {
                throw new IllegalArgumentException(
                        "A revoke view must remain in the revoked state");
            }
        }
    }

    private static void requireMatchingStatus(
            AuthorizationState state,
            StatusCode statusCode
    ) {
        StatusCode expected = switch (state) {
            case AUTHORIZED -> StatusCode.BROWSER_SESSION_AUTHORIZED;
            case AUTH_REQUIRED -> StatusCode.BROWSER_SESSION_AUTH_REQUIRED;
            case PENDING_INTERACTION ->
                    StatusCode.BROWSER_SESSION_PENDING_INTERACTION;
            case REVOKED -> StatusCode.BROWSER_SESSION_REVOKED;
            case UNKNOWN -> StatusCode.BROWSER_SESSION_UNKNOWN;
        };
        if (statusCode != expected) {
            throw new IllegalArgumentException(
                    "Authorization state and status code do not match");
        }
    }
}
