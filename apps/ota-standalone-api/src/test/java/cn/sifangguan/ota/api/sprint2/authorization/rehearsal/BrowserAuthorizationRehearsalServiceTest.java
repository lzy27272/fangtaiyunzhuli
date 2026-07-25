package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.lang.reflect.RecordComponent;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptState;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptView;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.CommandType;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.ConnectorDraftBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.PortResult;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BrowserAuthorizationRehearsalServiceTest {
    private static final Instant NOW = Instant.parse("2026-07-25T08:00:00Z");
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID HOTEL_ID = UUID.randomUUID();
    private static final UUID CONNECTOR_ID = UUID.randomUUID();
    private static final UUID CONNECTOR_VERSION_ID = UUID.randomUUID();
    private static final UUID ADMIN_ID = UUID.randomUUID();
    private static final UUID SESSION_ID = UUID.randomUUID();
    private static final UUID OTHER_ADMIN_ID = UUID.randomUUID();
    private static final long CONFIG_VERSION = 3;

    private InMemoryPort port;
    private RecordingAudit audit;
    private BrowserAuthorizationRehearsalService service;
    private AccountView admin;

    @BeforeEach
    void setUp() {
        port = new InMemoryPort();
        port.binding = eligibleBinding();
        audit = new RecordingAudit();
        service = serviceAt(NOW);
        admin = account(ADMIN_ID, OtaRole.PLATFORM_ADMIN);
    }

    @Test
    void completesOfflineRehearsalWithoutCreatingAuthorization() {
        AttemptView started = start(admin, "start-key-0001");

        assertThat(port.lastTrustedSessionId).isEqualTo(SESSION_ID);
        assertThat(started.mode()).isEqualTo("OFFLINE_REHEARSAL");
        assertThat(started.state()).isEqualTo(AttemptState.WAITING_FOR_OPERATOR);
        assertThat(started.authorizationState()).isEqualTo("AUTH_REQUIRED");
        assertThat(started.runtimeBlocked()).isTrue();
        assertThat(started.pmsConnected()).isFalse();
        assertThat(started.browserStarted()).isFalse();
        assertThat(started.credentialsRead()).isFalse();

        AttemptView completed = service.confirm(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                started.rowVersion(),
                "CONFIRM_OFFLINE_REHEARSAL",
                "confirm-key-0001",
                "correlation-confirm-0001");

        assertThat(completed.state())
                .isEqualTo(AttemptState.OFFLINE_REHEARSAL_COMPLETE);
        assertThat(completed.authorizationState()).isEqualTo("AUTH_REQUIRED");
        assertThat(completed.terminalAt()).isEqualTo(NOW);
        assertThat(completed.rowVersion()).isEqualTo(1);
        assertThat(port.lastTrustedSessionId).isEqualTo(SESSION_ID);
        assertThat(audit.events)
                .extracting(AuditEvent::eventType)
                .containsExactly(
                        "SPRINT2D_BROWSER_REHEARSAL_STARTED",
                        "SPRINT2D_BROWSER_REHEARSAL_CONFIRMED");
    }

    @Test
    void mutationFailsClosedWhenTrustedSessionContextIsMissing() {
        assertThatThrownBy(() -> service.start(
                admin,
                null,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONFIG_VERSION,
                "START_OFFLINE_REHEARSAL",
                "missing-session-key",
                "correlation-missing-session"))
                .isInstanceOf(SecurityException.class)
                .hasMessage("Authenticated session context is required");
        assertThat(port.attempts).isEmpty();
    }

    @Test
    void replaysSameIdempotencyKeyAndRejectsDifferentPayload() {
        AttemptView first = start(admin, "same-start-key");
        AttemptView replay = start(admin, "same-start-key");

        assertThat(replay.authorizationAttemptId())
                .isEqualTo(first.authorizationAttemptId());
        assertThat(replay.replayed()).isTrue();

        assertThatThrownBy(() -> service.start(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONFIG_VERSION,
                "DIFFERENT_REASON",
                "same-start-key",
                "correlation-different"))
                .isInstanceOf(BrowserAuthorizationRehearsalConflictException.class)
                .extracting("code")
                .isEqualTo("IDEMPOTENCY_KEY_CONFLICT");
    }

    @Test
    void cancellationAndReauthenticationCreateANewBoundAttempt() {
        AttemptView started = start(admin, "start-key-0002");
        AttemptView cancelled = service.cancel(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                0,
                "CANCEL_OFFLINE_REHEARSAL",
                "cancel-key-0002",
                "correlation-cancel-0002");

        AttemptView restarted = service.reauthenticate(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                cancelled.authorizationAttemptId(),
                cancelled.rowVersion(),
                "RESTART_OFFLINE_REHEARSAL",
                "restart-key-0002",
                "correlation-restart-0002");

        assertThat(cancelled.state()).isEqualTo(AttemptState.CANCELLED);
        assertThat(restarted.authorizationAttemptId())
                .isNotEqualTo(cancelled.authorizationAttemptId());
        assertThat(restarted.state())
                .isEqualTo(AttemptState.WAITING_FOR_OPERATOR);
        assertThat(restarted.authorizationState()).isEqualTo("AUTH_REQUIRED");
    }

    @Test
    void terminalTransitionCanReplayOnlyTheSameIdempotentCommand() {
        AttemptView started = start(admin, "start-key-replay-transition");
        AttemptView completed = service.confirm(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                0,
                "CONFIRM_OFFLINE_REHEARSAL",
                "confirm-key-replay-transition",
                "correlation-confirm-replay");
        AttemptView replay = service.confirm(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                0,
                "CONFIRM_OFFLINE_REHEARSAL",
                "confirm-key-replay-transition",
                "correlation-confirm-replay");

        assertThat(replay.authorizationAttemptId())
                .isEqualTo(completed.authorizationAttemptId());
        assertThat(replay.replayed()).isTrue();

        assertThatThrownBy(() -> service.cancel(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                completed.rowVersion(),
                "CANCEL_OFFLINE_REHEARSAL",
                "different-terminal-command",
                "correlation-terminal-conflict"))
                .isInstanceOf(BrowserAuthorizationRehearsalConflictException.class);
    }

    @Test
    void rejectsCrossActorMutationButAllowsGlobalReadInspection() {
        AttemptView started = start(admin, "start-key-0003");
        AccountView otherAdmin = account(
                OTHER_ADMIN_ID,
                OtaRole.PLATFORM_ADMIN);

        assertThatThrownBy(() -> service.confirm(
                otherAdmin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                started.rowVersion(),
                "CONFIRM_OFFLINE_REHEARSAL",
                "confirm-key-0003",
                "correlation-confirm-0003"))
                .isInstanceOf(SecurityException.class)
                .hasMessageContaining("another actor");

        AccountView manager = account(
                UUID.randomUUID(),
                OtaRole.OTA_OPERATION_MANAGER);
        AttemptView inspected = service.inspect(
                manager,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId());
        assertThat(inspected.authorizationAttemptId())
                .isEqualTo(started.authorizationAttemptId());
    }

    @Test
    void onlyPlatformAdminCanMutateEvenWhenRoleHasGlobalRead() {
        AccountView manager = account(
                UUID.randomUUID(),
                OtaRole.OTA_OPERATION_MANAGER);

        assertThatThrownBy(() -> start(manager, "start-key-0004"))
                .isInstanceOf(SecurityException.class)
                .hasMessageContaining("authorization permission");
    }

    @Test
    void rejectsWrongConfigMethodOrMissingOpaqueReference() {
        port.binding = new ConnectorDraftBinding(
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONNECTOR_VERSION_ID,
                CONFIG_VERSION,
                "PMS",
                "PMS_INTAKE",
                "0.0.0-config-only",
                "OFFICIAL_API",
                true,
                true);
        assertThatThrownBy(() -> start(admin, "start-key-0005"))
                .isInstanceOf(BrowserAuthorizationRehearsalConflictException.class)
                .extracting("code")
                .isEqualTo("CONNECTOR_NOT_READY_FOR_OFFLINE_REHEARSAL");

        port.binding = new ConnectorDraftBinding(
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONNECTOR_VERSION_ID,
                CONFIG_VERSION,
                "PMS",
                "PMS_INTAKE",
                "0.0.0-config-only",
                "CONTROLLED_BROWSER",
                false,
                true);
        assertThatThrownBy(() -> start(admin, "start-key-0006"))
                .isInstanceOf(BrowserAuthorizationRehearsalConflictException.class)
                .extracting("code")
                .isEqualTo("CONNECTOR_NOT_READY_FOR_OFFLINE_REHEARSAL");
    }

    @Test
    void expiryCannotBeConfirmedButCanStartFreshRehearsal() {
        AttemptView started = start(admin, "start-key-0007");
        BrowserAuthorizationRehearsalService afterExpiry =
                serviceAt(NOW.plusSeconds(901));

        AttemptView inspected = afterExpiry.inspect(
                admin,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId());
        assertThat(inspected.state()).isEqualTo(AttemptState.EXPIRED);
        assertThat(inspected.authorizationState()).isEqualTo("AUTH_REQUIRED");

        assertThatThrownBy(() -> afterExpiry.confirm(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                started.rowVersion(),
                "CONFIRM_OFFLINE_REHEARSAL",
                "confirm-key-0007",
                "correlation-confirm-0007"))
                .isInstanceOf(BrowserAuthorizationRehearsalConflictException.class)
                .extracting("code")
                .isEqualTo("AUTHORIZATION_STATE_CHANGED");

        AttemptView restarted = afterExpiry.reauthenticate(
                admin,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                started.authorizationAttemptId(),
                started.rowVersion(),
                "RESTART_OFFLINE_REHEARSAL",
                "restart-key-0007",
                "correlation-restart-0007");
        assertThat(restarted.state())
                .isEqualTo(AttemptState.WAITING_FOR_OPERATOR);
    }

    @Test
    void publicViewsContainNoCredentialShapedFields() {
        assertSecretFreeShape(AttemptView.class);
        assertSecretFreeShape(StoredAttempt.class);
        assertSecretFreeShape(StartCommand.class);
        assertSecretFreeShape(TransitionCommand.class);
        assertThat(List.of(AttemptState.values()))
                .extracting(Enum::name)
                .doesNotContain("AUTHORIZED", "ACTIVE", "VALID");
    }

    private AttemptView start(AccountView actor, String key) {
        return service.start(
                actor,
                SESSION_ID,
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONFIG_VERSION,
                "START_OFFLINE_REHEARSAL",
                key,
                "correlation-start-0001");
    }

    private BrowserAuthorizationRehearsalService serviceAt(Instant now) {
        SecureRandom random = new SecureRandom();
        random.setSeed(new byte[]{1, 2, 3, 4});
        return new BrowserAuthorizationRehearsalService(
                port,
                new DirectTenantExecutor(),
                audit,
                Clock.fixed(now, ZoneOffset.UTC),
                random,
                new OfflineRehearsalPolicyAdapter());
    }

    private static ConnectorDraftBinding eligibleBinding() {
        return new ConnectorDraftBinding(
                TENANT_ID,
                HOTEL_ID,
                CONNECTOR_ID,
                CONNECTOR_VERSION_ID,
                CONFIG_VERSION,
                "PMS",
                "PMS_INTAKE",
                "0.0.0-config-only",
                "CONTROLLED_BROWSER",
                true,
                true);
    }

    private static AccountView account(UUID id, OtaRole... roles) {
        return new AccountView(id, "Authorized operator", Set.of(roles));
    }

    private static void assertSecretFreeShape(Class<?> recordType) {
        assertThat(recordType.isRecord()).isTrue();
        assertThat(java.util.Arrays.stream(recordType.getRecordComponents())
                .map(RecordComponent::getName)
                .map(String::toLowerCase))
                .noneMatch(name -> name.contains("cookie")
                        || name.contains("password")
                        || name.contains("token")
                        || name.contains("header")
                        || name.contains("storagestate")
                        || name.contains("secretref")
                        || name.contains("url"));
    }

    private static final class DirectTenantExecutor
            implements TenantContextExecutor {
        @Override
        public <T> T inTenant(
                UUID tenantId,
                boolean readOnly,
                java.util.function.Supplier<T> work
        ) {
            assertThat(tenantId).isEqualTo(TENANT_ID);
            return work.get();
        }
    }

    private static final class RecordingAudit implements AuditPort {
        private final List<AuditEvent> events = new ArrayList<>();

        @Override
        public void append(AuditEvent event) {
            events.add(event);
        }
    }

    private static final class InMemoryPort
            implements BrowserAuthorizationRehearsalPort {
        private ConnectorDraftBinding binding;
        private UUID lastTrustedSessionId;
        private final Map<UUID, StoredAttempt> attempts = new HashMap<>();
        private final Map<String, Receipt> receipts = new HashMap<>();

        @Override
        public Optional<ConnectorDraftBinding> findConnectorDraft(
                UUID hotelId,
                UUID connectorId
        ) {
            if (binding == null
                    || !binding.hotelId().equals(hotelId)
                    || !binding.connectorId().equals(connectorId)) {
                return Optional.empty();
            }
            return Optional.of(binding);
        }

        @Override
        public Optional<StoredAttempt> findAttempt(
                UUID hotelId,
                UUID connectorId,
                UUID authorizationAttemptId
        ) {
            return Optional.ofNullable(attempts.get(authorizationAttemptId))
                    .filter(attempt -> attempt.hotelId().equals(hotelId)
                            && attempt.connectorId().equals(connectorId));
        }

        @Override
        public Optional<StoredAttempt> findLatestAttempt(
                UUID hotelId,
                UUID connectorId
        ) {
            return attempts.values().stream()
                    .filter(attempt -> attempt.hotelId().equals(hotelId)
                            && attempt.connectorId().equals(connectorId))
                    .max(java.util.Comparator.comparing(
                            StoredAttempt::requestedAt));
        }

        @Override
        public PortResult start(StartCommand command) {
            lastTrustedSessionId = command.trustedSessionId();
            Receipt replay = receipts.get(command.idempotencyKey());
            if (replay != null) {
                if (replay.commandType != command.commandType()
                        || !replay.requestHash.equals(command.requestHash())) {
                    throw new BrowserAuthorizationRehearsalConflictException(
                            "IDEMPOTENCY_KEY_CONFLICT");
                }
                return new PortResult(
                        replay.commandId,
                        attempts.get(replay.attemptId),
                        true);
            }
            if (command.predecessorAttemptId() != null) {
                StoredAttempt predecessor = attempts.get(
                        command.predecessorAttemptId());
                if (predecessor == null
                        || predecessor.rowVersion()
                        != command.predecessorExpectedRowVersion()) {
                    throw new BrowserAuthorizationRehearsalConflictException(
                            "AUTHORIZATION_ROW_VERSION_CHANGED");
                }
            }
            boolean open = attempts.values().stream()
                    .map(attempt -> attempt.effectiveAt(command.requestedAt()))
                    .anyMatch(attempt -> attempt.connectorId().equals(
                            command.connectorId())
                            && attempt.configVersion()
                            == command.binding().configVersion()
                            && !attempt.state().terminal());
            if (open) {
                throw new BrowserAuthorizationRehearsalConflictException(
                        "ACTIVE_REHEARSAL_ALREADY_EXISTS");
            }
            StoredAttempt attempt = new StoredAttempt(
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    command.binding().connectorVersionId(),
                    command.authorizationAttemptId(),
                    command.actorAccountId(),
                    command.binding().configVersion(),
                    command.binding().adapterCode(),
                    command.binding().adapterVersion(),
                    AttemptState.WAITING_FOR_OPERATOR,
                    command.requestedAt(),
                    command.requestedAt(),
                    command.expiresAt(),
                    null,
                    0);
            attempts.put(attempt.authorizationAttemptId(), attempt);
            UUID commandId = UUID.randomUUID();
            receipts.put(command.idempotencyKey(), new Receipt(
                    commandId,
                    command.commandType(),
                    command.requestHash(),
                    attempt.authorizationAttemptId()));
            return new PortResult(commandId, attempt, false);
        }

        @Override
        public PortResult transition(TransitionCommand command) {
            lastTrustedSessionId = command.trustedSessionId();
            Receipt replay = receipts.get(command.idempotencyKey());
            if (replay != null) {
                if (replay.commandType != command.commandType()
                        || !replay.requestHash.equals(command.requestHash())) {
                    throw new BrowserAuthorizationRehearsalConflictException(
                            "IDEMPOTENCY_KEY_CONFLICT");
                }
                return new PortResult(
                        replay.commandId,
                        attempts.get(replay.attemptId),
                        true);
            }
            StoredAttempt current = attempts.get(
                    command.authorizationAttemptId());
            if (current == null
                    || current.rowVersion() != command.expectedRowVersion()
                    || current.state() != AttemptState.WAITING_FOR_OPERATOR
                    || !current.expiresAt().isAfter(command.changedAt())
                    || !current.actorAccountId().equals(
                    command.actorAccountId())) {
                throw new BrowserAuthorizationRehearsalConflictException(
                        "AUTHORIZATION_STATE_CHANGED");
            }
            StoredAttempt changed = new StoredAttempt(
                    current.tenantId(),
                    current.hotelId(),
                    current.connectorId(),
                    current.connectorVersionId(),
                    current.authorizationAttemptId(),
                    current.actorAccountId(),
                    current.configVersion(),
                    current.adapterCode(),
                    current.adapterVersion(),
                    command.targetState(),
                    current.requestedAt(),
                    command.changedAt(),
                    current.expiresAt(),
                    command.changedAt(),
                    current.rowVersion() + 1);
            attempts.put(changed.authorizationAttemptId(), changed);
            UUID commandId = UUID.randomUUID();
            receipts.put(command.idempotencyKey(), new Receipt(
                    commandId,
                    command.commandType(),
                    command.requestHash(),
                    changed.authorizationAttemptId()));
            return new PortResult(commandId, changed, false);
        }

        private record Receipt(
                UUID commandId,
                CommandType commandType,
                String requestHash,
                UUID attemptId
        ) {
        }
    }
}
