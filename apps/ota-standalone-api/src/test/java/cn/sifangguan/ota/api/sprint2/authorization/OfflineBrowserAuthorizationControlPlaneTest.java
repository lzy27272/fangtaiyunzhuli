package cn.sifangguan.ota.api.sprint2.authorization;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;
import cn.sifangguan.ota.contracts.connector.AuthorizationContext;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationStartResult;
import cn.sifangguan.ota.contracts.connector.AuthorizationState;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.stereotype.Component;
import org.springframework.stereotype.Service;
import org.springframework.web.bind.annotation.RestController;

import java.lang.reflect.RecordComponent;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
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
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OfflineBrowserAuthorizationControlPlaneTest {
    private static final Instant NOW = Instant.parse("2026-07-25T04:00:00Z");
    private static final TenantHotelRef SCOPE = new TenantHotelRef(
            UUID.fromString("00000000-0000-0000-0000-000000000101"),
            UUID.fromString("00000000-0000-0000-0000-000000000201"));
    private static final UUID CONNECTOR_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000301");
    private static final UUID ATTEMPT_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000401");
    private static final UUID ACTOR_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000501");
    private static final UUID OTHER_ACTOR_ID =
            UUID.fromString("00000000-0000-0000-0000-000000000502");
    private static final TraceContext TRACE =
            new TraceContext("trace-browser-auth", "corr-browser-auth");

    private InMemoryBindingPort bindingPort;
    private OfflineBrowserAuthorizationControlPlane controlPlane;
    private AccountView actor;

    @BeforeEach
    void setUp() {
        bindingPort = new InMemoryBindingPort();
        controlPlane = controlPlaneAt(NOW);
        actor = account(ACTOR_ID);
    }

    @Test
    void bindsStartProbeAndRevokeToSafeServerSideScope() {
        ConnectorDescriptor descriptor = descriptor(
                "BYH_PMS_BROWSER",
                "0.1-test",
                SourceSystem.PMS,
                true,
                true);
        RecordingConnector connector = connector(
                descriptor,
                ATTEMPT_ID,
                NOW.plusSeconds(300));

        StartView started = controlPlane.start(
                actor,
                descriptor,
                connector,
                authorizationContext(
                        SCOPE,
                        CONNECTOR_ID,
                        1,
                        ATTEMPT_ID,
                        NOW.plusSeconds(600)));
        ProbeView probed = controlPlane.probe(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));
        RevokeView revoked = controlPlane.revoke(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));

        AuthorizationScopeView expected = new AuthorizationScopeView(
                SCOPE.tenantId(),
                SCOPE.hotelId(),
                CONNECTOR_ID,
                1,
                "BYH_PMS_BROWSER",
                "0.1-test",
                SourceSystem.PMS,
                ACTOR_ID,
                ATTEMPT_ID,
                new OpaqueInteractionReference(
                        "urn:sifangguan:browser-auth:" + ATTEMPT_ID),
                NOW.plusSeconds(300));
        assertThat(started.scope()).isEqualTo(expected);
        assertThat(started.statusCode())
                .isEqualTo(StatusCode.BROWSER_SESSION_PENDING_INTERACTION);
        assertThat(probed.scope()).isEqualTo(expected);
        assertThat(probed.statusCode())
                .isEqualTo(StatusCode.BROWSER_SESSION_AUTHORIZED);
        assertThat(probed.toString())
                .doesNotContain("must-not-cross", "cookie=");
        assertThat(revoked.scope()).isEqualTo(expected);
        assertThat(revoked.state()).isEqualTo(AuthorizationState.REVOKED);
        assertThat(bindingPort.find(ATTEMPT_ID).orElseThrow().lifecycle())
                .isEqualTo(BindingLifecycle.REVOKED);
        assertThat(connector.probeCalls).isEqualTo(1);
        assertThat(connector.revokeCalls).isEqualTo(1);
        assertThat(connector.lastProbeAttemptId).isEqualTo(ATTEMPT_ID);
        assertThat(connector.lastRevokeAttemptId).isEqualTo(ATTEMPT_ID);

        assertThatThrownBy(() -> controlPlane.probe(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, CONNECTOR_ID, 1)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("revoked");
    }

    @Test
    void rejectsCrossActorHotelConnectorAndConfigVersionBeforeConnectorCall() {
        ConnectorDescriptor descriptor = defaultDescriptor();
        RecordingConnector connector = connector(
                descriptor,
                ATTEMPT_ID,
                NOW.plusSeconds(300));
        start(actor, descriptor, connector, ATTEMPT_ID, NOW.plusSeconds(600));

        assertBindingMismatch(
                account(OTHER_ACTOR_ID),
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));
        assertBindingMismatch(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(
                        new TenantHotelRef(SCOPE.tenantId(), UUID.randomUUID()),
                        CONNECTOR_ID,
                        1));
        assertBindingMismatch(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, UUID.randomUUID(), 1));
        assertBindingMismatch(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                connectionContext(SCOPE, CONNECTOR_ID, 2));

        assertThat(connector.probeCalls).isZero();
    }

    @Test
    void rejectsDescriptorDriftUnknownAttemptAndPortAttemptAlias() {
        ConnectorDescriptor original = defaultDescriptor();
        RecordingConnector originalConnector = connector(
                original,
                ATTEMPT_ID,
                NOW.plusSeconds(300));
        start(
                actor,
                original,
                originalConnector,
                ATTEMPT_ID,
                NOW.plusSeconds(600));

        ConnectorDescriptor changedVersion = descriptor(
                "BYH_PMS_BROWSER",
                "0.2-test",
                SourceSystem.PMS,
                true,
                true);
        RecordingConnector changedConnector = connector(
                changedVersion,
                ATTEMPT_ID,
                NOW.plusSeconds(300));
        assertBindingMismatch(
                actor,
                ATTEMPT_ID,
                changedVersion,
                changedConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));

        UUID unknownAttempt = UUID.randomUUID();
        assertThatThrownBy(() -> controlPlane.probe(
                actor,
                unknownAttempt,
                original,
                originalConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not registered");

        UUID aliasAttempt = UUID.randomUUID();
        bindingPort.alias(
                aliasAttempt,
                bindingPort.find(ATTEMPT_ID).orElseThrow());
        assertBindingMismatch(
                actor,
                aliasAttempt,
                original,
                originalConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));

        assertThat(originalConnector.probeCalls).isZero();
        assertThat(changedConnector.probeCalls).isZero();
    }

    @Test
    void rejectsExpiredBindingAndExpiredOperationDeadline() {
        ConnectorDescriptor descriptor = defaultDescriptor();
        RecordingConnector connector = connector(
                descriptor,
                ATTEMPT_ID,
                NOW.plusSeconds(1));
        start(
                actor,
                descriptor,
                connector,
                ATTEMPT_ID,
                NOW.plusSeconds(10));

        OfflineBrowserAuthorizationControlPlane afterExpiry =
                controlPlaneAt(NOW.plusSeconds(2));
        assertThatThrownBy(() -> afterExpiry.probe(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                new ConnectionContext(
                        SCOPE,
                        CONNECTOR_ID,
                        1,
                        NOW.plusSeconds(60),
                        TRACE)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("expired");

        assertThatThrownBy(() -> controlPlane.probe(
                actor,
                ATTEMPT_ID,
                descriptor,
                connector,
                new ConnectionContext(
                        SCOPE,
                        CONNECTOR_ID,
                        1,
                        NOW,
                        TRACE)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("deadline");
        assertThat(connector.probeCalls).isZero();
    }

    @Test
    void rejectsDuplicateStartMismatchedResultAndExpiryExpansion() {
        ConnectorDescriptor descriptor = defaultDescriptor();
        RecordingConnector connector = connector(
                descriptor,
                ATTEMPT_ID,
                NOW.plusSeconds(300));
        start(actor, descriptor, connector, ATTEMPT_ID, NOW.plusSeconds(600));
        assertThatThrownBy(() -> start(
                actor,
                descriptor,
                connector,
                ATTEMPT_ID,
                NOW.plusSeconds(600)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("already registered");

        UUID secondAttempt = UUID.randomUUID();
        RecordingConnector mismatched = connector(
                descriptor,
                UUID.randomUUID(),
                NOW.plusSeconds(300));
        assertThatThrownBy(() -> start(
                actor,
                descriptor,
                mismatched,
                secondAttempt,
                NOW.plusSeconds(600)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("identity");

        UUID thirdAttempt = UUID.randomUUID();
        RecordingConnector expanded = connector(
                descriptor,
                thirdAttempt,
                NOW.plusSeconds(601));
        assertThatThrownBy(() -> start(
                actor,
                descriptor,
                expanded,
                thirdAttempt,
                NOW.plusSeconds(600)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("expiry");
    }

    @Test
    void keepsTwoAttemptsForTheSameConfigBoundToTheirOwnConnectorOperations() {
        ConnectorDescriptor descriptor = defaultDescriptor();
        UUID secondAttempt = UUID.randomUUID();
        RecordingConnector firstConnector = connector(
                descriptor,
                ATTEMPT_ID,
                NOW.plusSeconds(300));
        RecordingConnector secondConnector = connector(
                descriptor,
                secondAttempt,
                NOW.plusSeconds(300));
        start(
                actor,
                descriptor,
                firstConnector,
                ATTEMPT_ID,
                NOW.plusSeconds(600));
        start(
                actor,
                descriptor,
                secondConnector,
                secondAttempt,
                NOW.plusSeconds(600));

        controlPlane.probe(
                actor,
                ATTEMPT_ID,
                descriptor,
                firstConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));
        controlPlane.probe(
                actor,
                secondAttempt,
                descriptor,
                secondConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));
        controlPlane.revoke(
                actor,
                secondAttempt,
                descriptor,
                secondConnector,
                connectionContext(SCOPE, CONNECTOR_ID, 1));

        assertThat(firstConnector.lastProbeAttemptId).isEqualTo(ATTEMPT_ID);
        assertThat(firstConnector.lastRevokeAttemptId).isNull();
        assertThat(secondConnector.lastProbeAttemptId)
                .isEqualTo(secondAttempt);
        assertThat(secondConnector.lastRevokeAttemptId)
                .isEqualTo(secondAttempt);
        assertThat(bindingPort.find(ATTEMPT_ID).orElseThrow().lifecycle())
                .isEqualTo(BindingLifecycle.ACTIVE);
        assertThat(bindingPort.find(secondAttempt).orElseThrow().lifecycle())
                .isEqualTo(BindingLifecycle.REVOKED);
    }

    @Test
    void rejectsDescriptorWithoutInteractiveBrowserCapability() {
        assertThatThrownBy(() -> controlPlane.start(
                actor,
                descriptor(
                        "BYH_PMS_BROWSER",
                        "0.1-test",
                        SourceSystem.PMS,
                        false,
                        true),
                connector(
                        defaultDescriptor(),
                        ATTEMPT_ID,
                        NOW.plusSeconds(300)),
                authorizationContext(
                        SCOPE,
                        CONNECTOR_ID,
                        1,
                        ATTEMPT_ID,
                        NOW.plusSeconds(600))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("not eligible");
    }

    @Test
    void rejectsCredentialShapedInteractionValues() {
        assertThatThrownBy(
                () -> new OpaqueInteractionReference(
                        "https://pms.example/authorize"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("opaque");
        assertThatThrownBy(
                () -> new OpaqueInteractionReference(
                        "vault://ota/browser/session"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("opaque");
        assertThatThrownBy(
                () -> new OpaqueInteractionReference(
                        "cookie=session-value"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("opaque");
    }

    @Test
    void remainsUnregisteredAndExposesOnlySecretFreeRecords() {
        assertThat(OfflineBrowserAuthorizationControlPlane.class
                .getAnnotation(Component.class)).isNull();
        assertThat(OfflineBrowserAuthorizationControlPlane.class
                .getAnnotation(Service.class)).isNull();
        assertThat(OfflineBrowserAuthorizationControlPlane.class
                .getAnnotation(RestController.class)).isNull();
        assertThat(BrowserAuthorizationBindingPort.class.isInterface()).isTrue();

        assertSecretFreeShape(StartView.class);
        assertSecretFreeShape(ProbeView.class);
        assertSecretFreeShape(RevokeView.class);
        assertSecretFreeShape(OpaqueInteractionReference.class);
        assertSecretFreeShape(AuthorizationScopeView.class);
        assertSecretFreeShape(BrowserAuthorizationBinding.class);
    }

    private void assertBindingMismatch(
            AccountView operationActor,
            UUID attemptId,
            ConnectorDescriptor descriptor,
            RecordingConnector connector,
            ConnectionContext context
    ) {
        assertThatThrownBy(() -> controlPlane.probe(
                operationActor,
                attemptId,
                descriptor,
                connector,
                context))
                .isInstanceOf(SecurityException.class)
                .hasMessageContaining("registered binding");
    }

    private StartView start(
            AccountView startActor,
            ConnectorDescriptor descriptor,
            RecordingConnector connector,
            UUID attemptId,
            Instant contextExpiry
    ) {
        return controlPlane.start(
                startActor,
                descriptor,
                connector,
                authorizationContext(
                        SCOPE,
                        CONNECTOR_ID,
                        1,
                        attemptId,
                        contextExpiry));
    }

    private OfflineBrowserAuthorizationControlPlane controlPlaneAt(Instant now) {
        return new OfflineBrowserAuthorizationControlPlane(
                Clock.fixed(now, ZoneOffset.UTC),
                bindingPort);
    }

    private static void assertSecretFreeShape(Class<?> recordType) {
        assertThat(recordType.isRecord()).isTrue();
        assertThat(Arrays.stream(recordType.getRecordComponents())
                .map(RecordComponent::getName)
                .map(String::toLowerCase))
                .noneMatch(name -> name.contains("cookie")
                        || name.contains("storagestate")
                        || name.contains("password")
                        || name.contains("token")
                        || name.contains("secret"));
    }

    private static AccountView account(UUID id) {
        return new AccountView(
                id,
                "Authorized operator",
                Set.of(OtaRole.PLATFORM_ADMIN));
    }

    private static ConnectorDescriptor defaultDescriptor() {
        return descriptor(
                "BYH_PMS_BROWSER",
                "0.1-test",
                SourceSystem.PMS,
                true,
                true);
    }

    private static ConnectorDescriptor descriptor(
            String connectorCode,
            String adapterVersion,
            SourceSystem sourceSystem,
            boolean interactive,
            boolean browserCapability
    ) {
        Set<ConnectorCapability> capabilities = browserCapability
                ? Set.of(
                ConnectorCapability.BROWSER_SESSION_AUTH,
                ConnectorCapability.PMS_BUSINESS_DATE)
                : Set.of(ConnectorCapability.PMS_BUSINESS_DATE);
        return new ConnectorDescriptor(
                connectorCode,
                sourceSystem,
                adapterVersion,
                capabilities,
                Set.of(DataStreamType.BUSINESS_DATE),
                interactive);
    }

    private static AuthorizationContext authorizationContext(
            TenantHotelRef scope,
            UUID connectorId,
            long configVersion,
            UUID attemptId,
            Instant expiresAt
    ) {
        return new AuthorizationContext(
                scope,
                connectorId,
                configVersion,
                attemptId,
                expiresAt,
                TRACE);
    }

    private static ConnectionContext connectionContext(
            TenantHotelRef scope,
            UUID connectorId,
            long configVersion
    ) {
        return new ConnectionContext(
                scope,
                connectorId,
                configVersion,
                NOW.plusSeconds(60),
                TRACE);
    }

    private static RecordingConnector connector(
            ConnectorDescriptor descriptor,
            UUID resultAttemptId,
            Instant resultExpiry
    ) {
        return new RecordingConnector(
                descriptor,
                new AuthorizationStartResult(
                        resultAttemptId,
                        AuthorizationState.PENDING_INTERACTION,
                        resultExpiry,
                        "urn:sifangguan:browser-auth:" + resultAttemptId));
    }

    private static final class RecordingConnector
            implements DescriptorBoundInteractiveAuthorizationConnector {
        private final ConnectorDescriptor descriptor;
        private final AuthorizationStartResult startResult;
        private int probeCalls;
        private int revokeCalls;
        private UUID lastProbeAttemptId;
        private UUID lastRevokeAttemptId;

        private RecordingConnector(
                ConnectorDescriptor descriptor,
                AuthorizationStartResult startResult
        ) {
            this.descriptor = descriptor;
            this.startResult = startResult;
        }

        @Override
        public ConnectorDescriptor descriptor() {
            return descriptor;
        }

        @Override
        public AuthorizationStartResult startAuthorization(
                AuthorizationContext context
        ) {
            return startResult;
        }

        @Override
        public AuthorizationProbeResult probeAuthorization(
                UUID authorizationAttemptId,
                ConnectionContext context
        ) {
            probeCalls++;
            lastProbeAttemptId = authorizationAttemptId;
            return new AuthorizationProbeResult(
                    AuthorizationState.AUTHORIZED,
                    NOW.plusSeconds(30),
                    "cookie=must-not-cross-the-control-plane");
        }

        @Override
        public void revokeAuthorization(
                UUID authorizationAttemptId,
                ConnectionContext context
        ) {
            revokeCalls++;
            lastRevokeAttemptId = authorizationAttemptId;
        }
    }

    private static final class InMemoryBindingPort
            implements BrowserAuthorizationBindingPort {
        private final Map<UUID, BrowserAuthorizationBinding> entries =
                new HashMap<>();

        @Override
        public void register(BrowserAuthorizationBinding binding) {
            if (entries.putIfAbsent(
                    binding.authorizationAttemptId(),
                    binding) != null) {
                throw new IllegalStateException(
                        "Authorization attempt is already registered");
            }
        }

        @Override
        public Optional<BrowserAuthorizationBinding> find(
                UUID authorizationAttemptId
        ) {
            return Optional.ofNullable(entries.get(authorizationAttemptId));
        }

        @Override
        public BrowserAuthorizationBinding revoke(
                BrowserAuthorizationBinding expectedActiveBinding,
                Instant revokedAt
        ) {
            if (revokedAt == null
                    || !entries.replace(
                    expectedActiveBinding.authorizationAttemptId(),
                    expectedActiveBinding,
                    expectedActiveBinding.revoked())) {
                throw new IllegalStateException(
                        "Authorization binding changed concurrently");
            }
            return entries.get(expectedActiveBinding.authorizationAttemptId());
        }

        void alias(UUID key, BrowserAuthorizationBinding binding) {
            entries.put(key, binding);
        }
    }
}
