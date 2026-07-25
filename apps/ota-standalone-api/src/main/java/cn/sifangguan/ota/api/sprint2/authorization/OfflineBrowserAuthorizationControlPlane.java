package cn.sifangguan.ota.api.sprint2.authorization;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.contracts.connector.AuthorizationContext;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationStartResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Clock;
import java.time.Instant;
import java.util.EnumSet;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.authorization.BrowserAuthorizationBindingPort.BindingLifecycle;
import static cn.sifangguan.ota.api.sprint2.authorization.BrowserAuthorizationBindingPort.BrowserAuthorizationBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.AuthorizationScopeView;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.OpaqueInteractionReference;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.ProbeView;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.RevokeView;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.StartView;
import static cn.sifangguan.ota.api.sprint2.authorization.OfflineBrowserAuthorizationModels.StatusCode;

/**
 * Pure, offline orchestration boundary for interactive browser authorization.
 *
 * <p>This class is intentionally not registered with Spring and the binding
 * port intentionally has no production implementation.</p>
 */
public final class OfflineBrowserAuthorizationControlPlane {
    private static final Set<SourceSystem> ALLOWED_SOURCES =
            EnumSet.of(SourceSystem.PMS, SourceSystem.CTRIP, SourceSystem.MEITUAN);

    private final Clock clock;
    private final BrowserAuthorizationBindingPort bindings;

    public OfflineBrowserAuthorizationControlPlane(
            Clock clock,
            BrowserAuthorizationBindingPort bindings
    ) {
        this.clock = Objects.requireNonNull(clock, "clock");
        this.bindings = Objects.requireNonNull(bindings, "bindings");
    }

    public StartView start(
            AccountView authenticatedActor,
            ConnectorDescriptor descriptor,
            DescriptorBoundInteractiveAuthorizationConnector connector,
            AuthorizationContext context
    ) {
        UUID actorAccountId = requireAuthenticatedActor(authenticatedActor);
        Objects.requireNonNull(context, "context");
        requireConsistentConnector(descriptor, connector);
        if (!context.expiresAt().isAfter(clock.instant())) {
            throw new IllegalArgumentException(
                    "Authorization context has expired");
        }
        if (bindings.find(context.authorizationAttemptId()).isPresent()) {
            throw new IllegalStateException(
                    "Authorization attempt is already registered");
        }

        AuthorizationStartResult result = Objects.requireNonNull(
                connector.startAuthorization(context),
                "authorization start result");
        requireConsistentStartResult(context, result);
        OpaqueInteractionReference reference =
                new OpaqueInteractionReference(result.interactionReference());
        BrowserAuthorizationBinding binding = new BrowserAuthorizationBinding(
                context.scope().tenantId(),
                context.scope().hotelId(),
                context.connectorId(),
                context.configVersion(),
                descriptor.connectorCode(),
                descriptor.adapterVersion(),
                descriptor.sourceSystem(),
                actorAccountId,
                context.authorizationAttemptId(),
                reference,
                result.expiresAt(),
                BindingLifecycle.ACTIVE);
        bindings.register(binding);
        BrowserAuthorizationBinding registered = bindings
                .find(context.authorizationAttemptId())
                .orElseThrow(() -> new IllegalStateException(
                        "Authorization binding was not registered"));
        if (!binding.equals(registered)) {
            throw new IllegalStateException(
                    "Registered authorization binding does not match the request");
        }
        return new StartView(
                AuthorizationScopeView.from(registered),
                result.state(),
                statusCode(result.state()));
    }

    public ProbeView probe(
            AccountView authenticatedActor,
            UUID authorizationAttemptId,
            ConnectorDescriptor descriptor,
            DescriptorBoundInteractiveAuthorizationConnector connector,
            ConnectionContext context
    ) {
        BrowserAuthorizationBinding binding = requireActiveBinding(
                authenticatedActor,
                authorizationAttemptId,
                descriptor,
                connector,
                context);
        AuthorizationProbeResult result = Objects.requireNonNull(
                connector.probeAuthorization(
                        authorizationAttemptId,
                        context),
                "authorization probe result");
        if (result.observedAt().isAfter(context.deadline())) {
            throw new IllegalStateException(
                    "Authorization probe observation exceeds its deadline");
        }
        return new ProbeView(
                AuthorizationScopeView.from(binding),
                result.state(),
                statusCode(result.state()),
                result.observedAt());
    }

    public RevokeView revoke(
            AccountView authenticatedActor,
            UUID authorizationAttemptId,
            ConnectorDescriptor descriptor,
            DescriptorBoundInteractiveAuthorizationConnector connector,
            ConnectionContext context
    ) {
        BrowserAuthorizationBinding binding = requireActiveBinding(
                authenticatedActor,
                authorizationAttemptId,
                descriptor,
                connector,
                context);
        connector.revokeAuthorization(
                authorizationAttemptId,
                context);
        Instant revokedAt = clock.instant();
        BrowserAuthorizationBinding revoked =
                bindings.revoke(binding, revokedAt);
        if (!binding.revoked().equals(revoked)) {
            throw new IllegalStateException(
                    "Revoked authorization binding does not match the request");
        }
        return new RevokeView(
                AuthorizationScopeView.from(revoked),
                AuthorizationState.REVOKED,
                StatusCode.BROWSER_SESSION_REVOKED,
                revokedAt);
    }

    private BrowserAuthorizationBinding requireActiveBinding(
            AccountView authenticatedActor,
            UUID authorizationAttemptId,
            ConnectorDescriptor descriptor,
            DescriptorBoundInteractiveAuthorizationConnector connector,
            ConnectionContext context
    ) {
        UUID actorAccountId = requireAuthenticatedActor(authenticatedActor);
        Objects.requireNonNull(
                authorizationAttemptId,
                "authorizationAttemptId");
        Objects.requireNonNull(context, "context");
        requireConsistentConnector(descriptor, connector);
        requireLiveDeadline(context);

        BrowserAuthorizationBinding binding = bindings
                .find(authorizationAttemptId)
                .orElseThrow(() -> new IllegalArgumentException(
                        "Authorization attempt is not registered"));
        if (!authorizationAttemptId.equals(binding.authorizationAttemptId())
                || !context.scope().tenantId().equals(binding.tenantId())
                || !context.scope().hotelId().equals(binding.hotelId())
                || !context.connectorId().equals(binding.connectorId())
                || context.configVersion() != binding.configVersion()
                || !descriptor.connectorCode().equals(binding.connectorCode())
                || !descriptor.adapterVersion().equals(binding.adapterVersion())
                || descriptor.sourceSystem() != binding.sourceSystem()
                || !actorAccountId.equals(binding.actorAccountId())) {
            throw new SecurityException(
                    "Authorization operation does not match its registered binding");
        }
        if (binding.lifecycle() == BindingLifecycle.REVOKED) {
            throw new IllegalStateException(
                    "Authorization binding has been revoked");
        }
        if (!binding.expiresAt().isAfter(clock.instant())) {
            throw new IllegalStateException(
                    "Authorization binding has expired");
        }
        return binding;
    }

    private void requireConsistentStartResult(
            AuthorizationContext context,
            AuthorizationStartResult result
    ) {
        if (!context.authorizationAttemptId().equals(
                result.authorizationAttemptId())) {
            throw new IllegalStateException(
                    "Authorization attempt identity does not match the request");
        }
        if (result.expiresAt().isAfter(context.expiresAt())) {
            throw new IllegalStateException(
                    "Authorization result exceeds the requested expiry");
        }
        if (!result.expiresAt().isAfter(clock.instant())) {
            throw new IllegalStateException(
                    "Authorization result is already expired");
        }
        if (result.state() == AuthorizationState.REVOKED
                || result.state() == AuthorizationState.UNKNOWN) {
            throw new IllegalStateException(
                    "Authorization start returned an invalid lifecycle state");
        }
    }

    private static void requireConsistentConnector(
            ConnectorDescriptor descriptor,
            DescriptorBoundInteractiveAuthorizationConnector connector
    ) {
        requireBrowserAuthorizationCapability(descriptor);
        Objects.requireNonNull(connector, "connector");
        ConnectorDescriptor connectorDescriptor = Objects.requireNonNull(
                connector.descriptor(),
                "connector descriptor");
        if (!descriptor.equals(connectorDescriptor)) {
            throw new IllegalArgumentException(
                    "Connector descriptor does not match the authorization binding");
        }
    }

    private static UUID requireAuthenticatedActor(AccountView actor) {
        Objects.requireNonNull(actor, "authenticatedActor");
        return Objects.requireNonNull(actor.id(), "authenticatedActor.id");
    }

    private void requireLiveDeadline(ConnectionContext context) {
        if (!context.deadline().isAfter(clock.instant())) {
            throw new IllegalArgumentException(
                    "Authorization operation deadline has expired");
        }
    }

    private static void requireBrowserAuthorizationCapability(
            ConnectorDescriptor descriptor
    ) {
        Objects.requireNonNull(descriptor, "descriptor");
        if (!descriptor.interactiveAuthorization()
                || !descriptor.capabilities().contains(
                ConnectorCapability.BROWSER_SESSION_AUTH)
                || !ALLOWED_SOURCES.contains(descriptor.sourceSystem())) {
            throw new IllegalArgumentException(
                    "Connector is not eligible for interactive browser authorization");
        }
    }

    private static StatusCode statusCode(AuthorizationState state) {
        return switch (Objects.requireNonNull(state, "state")) {
            case AUTHORIZED -> StatusCode.BROWSER_SESSION_AUTHORIZED;
            case AUTH_REQUIRED -> StatusCode.BROWSER_SESSION_AUTH_REQUIRED;
            case PENDING_INTERACTION ->
                    StatusCode.BROWSER_SESSION_PENDING_INTERACTION;
            case REVOKED -> StatusCode.BROWSER_SESSION_REVOKED;
            case UNKNOWN -> StatusCode.BROWSER_SESSION_UNKNOWN;
        };
    }
}
