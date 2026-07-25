package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptState;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptView;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.CommandType;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.ConnectorDraftBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.PortResult;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;

public final class BrowserAuthorizationRehearsalService {
    private static final Duration ATTEMPT_TTL = Duration.ofMinutes(15);
    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("[A-Za-z0-9._:-]{8,200}");
    private static final Pattern REASON_CODE =
            Pattern.compile("[A-Z][A-Z0-9_]{2,63}");

    private final BrowserAuthorizationRehearsalPort port;
    private final TenantContextExecutor tenants;
    private final AuditPort audit;
    private final Clock clock;
    private final SecureRandom secureRandom;
    private final OfflineRehearsalPolicyAdapter offlinePolicy;

    public BrowserAuthorizationRehearsalService(
            BrowserAuthorizationRehearsalPort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock,
            SecureRandom secureRandom,
            OfflineRehearsalPolicyAdapter offlinePolicy
    ) {
        this.port = Objects.requireNonNull(port, "port");
        this.tenants = Objects.requireNonNull(tenants, "tenants");
        this.audit = Objects.requireNonNull(audit, "audit");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.secureRandom = Objects.requireNonNull(secureRandom, "secureRandom");
        this.offlinePolicy = Objects.requireNonNull(
                offlinePolicy,
                "offlinePolicy");
    }

    public AttemptView start(
            AccountView account,
            UUID trustedSessionId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            long expectedConfigVersion,
            String reasonCode,
            String idempotencyKey,
            String correlationId
    ) {
        requireManage(account, trustedSessionId);
        validateEnvelope(expectedConfigVersion, reasonCode, idempotencyKey);
        String requestHash = hash(
                "START",
                tenantId,
                hotelId,
                connectorId,
                expectedConfigVersion,
                reasonCode);
        return executeMutation(
                account,
                tenantId,
                hotelId,
                connectorId,
                requestHash,
                correlationId,
                "SPRINT2D_BROWSER_REHEARSAL_STARTED",
                () -> {
                    ConnectorDraftBinding binding = requireBinding(
                            tenantId,
                            hotelId,
                            connectorId,
                            expectedConfigVersion);
                    Instant now = clock.instant();
                    StartCommand command = new StartCommand(
                            tenantId,
                            hotelId,
                            connectorId,
                            binding,
                            UUID.randomUUID(),
                            account.id(),
                            trustedSessionId,
                            CommandType.START_REHEARSAL,
                            null,
                            null,
                            idempotencyKey,
                            reasonCode,
                            requestHash,
                            randomDigest(),
                            now,
                            now.plus(ATTEMPT_TTL));
                    offlinePolicy.requirePrepared(command);
                    return view(port.start(command));
                });
    }

    public AttemptView inspect(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId
    ) {
        requireGlobalRead(account);
        requireIdentifiers(
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId);
        return tenants.inTenant(tenantId, true, () -> AttemptView.from(
                requireAttempt(
                        tenantId,
                        hotelId,
                        connectorId,
                        authorizationAttemptId),
                false,
                clock.instant()));
    }

    public AttemptView latest(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId
    ) {
        requireGlobalRead(account);
        requireIdentifiers(tenantId, hotelId, connectorId);
        return tenants.inTenant(tenantId, true, () -> port.findLatestAttempt(
                        hotelId,
                        connectorId)
                .map(attempt -> {
                    if (!attempt.tenantId().equals(tenantId)
                            || !attempt.hotelId().equals(hotelId)
                            || !attempt.connectorId().equals(connectorId)) {
                        throw new SecurityException(
                                "Authorization rehearsal does not match the requested scope");
                    }
                    return AttemptView.from(
                            attempt,
                            false,
                            clock.instant());
                })
                .orElse(null));
    }

    public AttemptView confirm(
            AccountView account,
            UUID trustedSessionId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            String correlationId
    ) {
        return transition(
                account,
                trustedSessionId,
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId,
                expectedRowVersion,
                reasonCode,
                idempotencyKey,
                correlationId,
                CommandType.CONFIRM_REHEARSAL,
                AttemptState.OFFLINE_REHEARSAL_COMPLETE,
                "SPRINT2D_BROWSER_REHEARSAL_CONFIRMED");
    }

    public AttemptView cancel(
            AccountView account,
            UUID trustedSessionId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            String correlationId
    ) {
        return transition(
                account,
                trustedSessionId,
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId,
                expectedRowVersion,
                reasonCode,
                idempotencyKey,
                correlationId,
                CommandType.CANCEL_REHEARSAL,
                AttemptState.CANCELLED,
                "SPRINT2D_BROWSER_REHEARSAL_CANCELLED");
    }

    public AttemptView reauthenticate(
            AccountView account,
            UUID trustedSessionId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            String correlationId
    ) {
        requireManage(account, trustedSessionId);
        validateEnvelope(expectedRowVersion, reasonCode, idempotencyKey);
        requireIdentifiers(
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId);
        String requestHash = hash(
                "REAUTHENTICATE",
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId,
                expectedRowVersion,
                reasonCode);
        return executeMutation(
                account,
                tenantId,
                hotelId,
                connectorId,
                requestHash,
                correlationId,
                "SPRINT2D_BROWSER_REHEARSAL_REAUTHENTICATED",
                () -> {
                    StoredAttempt predecessor = requireOwnedAttempt(
                            account,
                            tenantId,
                            hotelId,
                            connectorId,
                            authorizationAttemptId).effectiveAt(clock.instant());
                    if (!predecessor.state().terminal()) {
                        throw new BrowserAuthorizationRehearsalConflictException(
                                "ACTIVE_REHEARSAL_MUST_BE_CANCELLED_FIRST");
                    }
                    ConnectorDraftBinding binding = requireBinding(
                            tenantId,
                            hotelId,
                            connectorId,
                            predecessor.configVersion());
                    Instant now = clock.instant();
                    StartCommand command = new StartCommand(
                            tenantId,
                            hotelId,
                            connectorId,
                            binding,
                            UUID.randomUUID(),
                            account.id(),
                            trustedSessionId,
                            CommandType.REAUTHENTICATE_REHEARSAL,
                            predecessor.authorizationAttemptId(),
                            expectedRowVersion,
                            idempotencyKey,
                            reasonCode,
                            requestHash,
                            randomDigest(),
                            now,
                            now.plus(ATTEMPT_TTL));
                    offlinePolicy.requirePrepared(command);
                    return view(port.start(command));
                });
    }

    private AttemptView transition(
            AccountView account,
            UUID trustedSessionId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            String correlationId,
            CommandType commandType,
            AttemptState targetState,
            String auditEventType
    ) {
        requireManage(account, trustedSessionId);
        validateEnvelope(expectedRowVersion, reasonCode, idempotencyKey);
        requireIdentifiers(
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId);
        String requestHash = hash(
                commandType,
                tenantId,
                hotelId,
                connectorId,
                authorizationAttemptId,
                expectedRowVersion,
                reasonCode);
        return executeMutation(
                account,
                tenantId,
                hotelId,
                connectorId,
                requestHash,
                correlationId,
                auditEventType,
                () -> {
                    StoredAttempt current = requireOwnedAttempt(
                            account,
                            tenantId,
                            hotelId,
                            connectorId,
                            authorizationAttemptId).effectiveAt(clock.instant());
                    TransitionCommand command = new TransitionCommand(
                            tenantId,
                            hotelId,
                            connectorId,
                            authorizationAttemptId,
                            account.id(),
                            trustedSessionId,
                            expectedRowVersion,
                            commandType,
                            targetState,
                            idempotencyKey,
                            reasonCode,
                            requestHash,
                            clock.instant());
                    if (current.state()
                            == AttemptState.WAITING_FOR_OPERATOR) {
                        if (current.rowVersion() != expectedRowVersion) {
                            throw new BrowserAuthorizationRehearsalConflictException(
                                    "AUTHORIZATION_ROW_VERSION_CHANGED");
                        }
                        offlinePolicy.requireTransitionAllowed(
                                current,
                                command);
                    }
                    return view(port.transition(command));
                });
    }

    private ConnectorDraftBinding requireBinding(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            long expectedConfigVersion
    ) {
        ConnectorDraftBinding binding = port.findConnectorDraft(
                        hotelId,
                        connectorId)
                .orElseThrow(BrowserAuthorizationRehearsalNotFoundException::new);
        binding.requireEligible(
                tenantId,
                hotelId,
                connectorId,
                expectedConfigVersion);
        return binding;
    }

    private StoredAttempt requireOwnedAttempt(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID attemptId
    ) {
        StoredAttempt attempt = requireAttempt(
                tenantId,
                hotelId,
                connectorId,
                attemptId);
        if (!attempt.actorAccountId().equals(account.id())) {
            throw new SecurityException(
                    "Authorization rehearsal is bound to another actor");
        }
        return attempt;
    }

    private StoredAttempt requireAttempt(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID attemptId
    ) {
        StoredAttempt attempt = port.findAttempt(
                        hotelId,
                        connectorId,
                        attemptId)
                .orElseThrow(BrowserAuthorizationRehearsalNotFoundException::new);
        if (!attempt.tenantId().equals(tenantId)
                || !attempt.hotelId().equals(hotelId)
                || !attempt.connectorId().equals(connectorId)
                || !attempt.authorizationAttemptId().equals(attemptId)) {
            throw new SecurityException(
                    "Authorization rehearsal does not match the requested scope");
        }
        return attempt;
    }

    private AttemptView executeMutation(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash,
            String correlationId,
            String eventType,
            Operation operation
    ) {
        try {
            return tenants.inTenant(tenantId, false, () -> {
                AttemptView result = operation.execute();
                audit.appendInCurrentTransaction(event(
                        account,
                        eventType,
                        "SUCCEEDED",
                        null,
                        correlationId,
                        tenantId,
                        hotelId,
                        connectorId,
                        requestHash));
                return result;
            });
        } catch (RuntimeException failure) {
            audit.append(event(
                    account,
                    eventType,
                    "FAILED",
                    "OFFLINE_REHEARSAL_COMMAND_REJECTED",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    requestHash));
            throw failure;
        }
    }

    private AttemptView view(PortResult result) {
        return AttemptView.from(
                result.attempt(),
                result.replayed(),
                clock.instant());
    }

    private void requireManage(
            AccountView account,
            UUID trustedSessionId
    ) {
        Objects.requireNonNull(account, "account");
        if (trustedSessionId == null) {
            throw new SecurityException(
                    "Authenticated session context is required");
        }
        TrustedAuthorizationContext authorization =
                TrustedAuthorizationContext.fromAuthenticatedAccount(account);
        if (!account.roles().contains(OtaRole.PLATFORM_ADMIN)
                || !authorization.has(
                OtaPermission.CONNECTOR_AUTHORIZATION_MANAGE)) {
            throw new SecurityException(
                    "Explicit connector authorization permission is required");
        }
    }

    private static void requireGlobalRead(AccountView account) {
        Objects.requireNonNull(account, "account");
        if (account.roles().stream().noneMatch(OtaRole::hasGlobalReadAccess)) {
            throw new SecurityException("Global OTA read access is required");
        }
    }

    private static void requireIdentifiers(UUID... values) {
        for (UUID value : values) {
            Objects.requireNonNull(value, "identifier");
        }
    }

    private static void validateEnvelope(
            long expectedVersion,
            String reasonCode,
            String idempotencyKey
    ) {
        if (expectedVersion < 0
                || reasonCode == null
                || !REASON_CODE.matcher(reasonCode).matches()
                || idempotencyKey == null
                || !IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()) {
            throw new IllegalArgumentException(
                    "Offline rehearsal command envelope is invalid");
        }
    }

    private String randomDigest() {
        byte[] random = new byte[32];
        secureRandom.nextBytes(random);
        try {
            return sha256(random);
        } finally {
            Arrays.fill(random, (byte) 0);
        }
    }

    private static String hash(Object... values) {
        StringBuilder canonical = new StringBuilder();
        for (Object value : values) {
            String text = Objects.toString(value, "");
            canonical.append(text.length()).append(':').append(text).append('|');
        }
        return sha256(canonical.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private AuditEvent event(
            AccountView account,
            String eventType,
            String outcome,
            String reason,
            String correlationId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash
    ) {
        return new AuditEvent(
                UUID.randomUUID(),
                eventType,
                account.id(),
                outcome,
                reason,
                correlationId,
                clock.instant(),
                "BROWSER_AUTHORIZATION_REHEARSAL",
                connectorId,
                tenantId,
                hotelId,
                "OFFLINE_REHEARSAL",
                requestHash);
    }

    @FunctionalInterface
    private interface Operation {
        AttemptView execute();
    }
}
