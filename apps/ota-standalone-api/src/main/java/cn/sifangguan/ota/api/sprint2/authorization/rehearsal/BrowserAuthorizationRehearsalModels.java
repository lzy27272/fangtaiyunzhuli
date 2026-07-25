package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Secret-free models for the offline manual-authorization rehearsal.
 *
 * <p>The rehearsal never represents a live PMS authorization. Its externally
 * visible authorization state is therefore fixed to {@code AUTH_REQUIRED},
 * including after the operator completes the rehearsal.</p>
 */
public final class BrowserAuthorizationRehearsalModels {
    public static final String MODE = "OFFLINE_REHEARSAL";
    public static final String AUTHORIZATION_STATE = "AUTH_REQUIRED";

    private BrowserAuthorizationRehearsalModels() {
    }

    public enum AttemptState {
        WAITING_FOR_OPERATOR(false),
        OFFLINE_REHEARSAL_COMPLETE(true),
        CANCELLED(true),
        EXPIRED(true),
        FAILED(true);

        private final boolean terminal;

        AttemptState(boolean terminal) {
            this.terminal = terminal;
        }

        public boolean terminal() {
            return terminal;
        }
    }

    public enum CommandType {
        START_REHEARSAL,
        CONFIRM_REHEARSAL,
        CANCEL_REHEARSAL,
        REAUTHENTICATE_REHEARSAL
    }

    public record ConnectorDraftBinding(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            long configVersion,
            String sourceCode,
            String adapterCode,
            String adapterVersion,
            String connectionMethod,
            boolean browserSessionReferenceConfigured,
            boolean runtimeBlocked
    ) {
        private static final Pattern SAFE_CODE =
                Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,95}");

        public ConnectorDraftBinding {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            sourceCode = requireCode(sourceCode, "sourceCode");
            adapterCode = requireCode(adapterCode, "adapterCode");
            adapterVersion = requireCode(adapterVersion, "adapterVersion");
            connectionMethod = requireCode(connectionMethod, "connectionMethod");
            if (configVersion < 0) {
                throw new IllegalArgumentException(
                        "configVersion must be non-negative");
            }
        }

        public void requireEligible(
                UUID expectedTenantId,
                UUID expectedHotelId,
                UUID expectedConnectorId,
                long expectedConfigVersion
        ) {
            if (!tenantId.equals(expectedTenantId)
                    || !hotelId.equals(expectedHotelId)
                    || !connectorId.equals(expectedConnectorId)) {
                throw new SecurityException(
                        "Connector draft does not match the requested scope");
            }
            if (configVersion != expectedConfigVersion) {
                throw new BrowserAuthorizationRehearsalConflictException(
                        "AUTHORIZATION_CONFIG_VERSION_CHANGED");
            }
            if (!"PMS".equals(sourceCode)
                    || !"CONTROLLED_BROWSER".equals(connectionMethod)
                    || !browserSessionReferenceConfigured
                    || !runtimeBlocked) {
                throw new BrowserAuthorizationRehearsalConflictException(
                        "CONNECTOR_NOT_READY_FOR_OFFLINE_REHEARSAL");
            }
        }

        private static String requireCode(String value, String name) {
            Objects.requireNonNull(value, name);
            if (!SAFE_CODE.matcher(value).matches()) {
                throw new IllegalArgumentException(name + " is invalid");
            }
            return value;
        }
    }

    public record StoredAttempt(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            UUID authorizationAttemptId,
            UUID actorAccountId,
            long configVersion,
            String adapterCode,
            String adapterVersion,
            AttemptState state,
            Instant requestedAt,
            Instant changedAt,
            Instant expiresAt,
            Instant terminalAt,
            long rowVersion
    ) {
        public StoredAttempt {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(adapterCode, "adapterCode");
            Objects.requireNonNull(adapterVersion, "adapterVersion");
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(requestedAt, "requestedAt");
            Objects.requireNonNull(changedAt, "changedAt");
            Objects.requireNonNull(expiresAt, "expiresAt");
            if (configVersion < 0 || rowVersion < 0) {
                throw new IllegalArgumentException(
                        "Versions must be non-negative");
            }
            if (expiresAt.isBefore(requestedAt)
                    || changedAt.isBefore(requestedAt)) {
                throw new IllegalArgumentException(
                        "Attempt timestamps are not monotonic");
            }
            if (state.terminal() != (terminalAt != null)) {
                throw new IllegalArgumentException(
                        "Terminal state and terminalAt must agree");
            }
        }

        public StoredAttempt effectiveAt(Instant now) {
            Objects.requireNonNull(now, "now");
            if (state == AttemptState.WAITING_FOR_OPERATOR
                    && !expiresAt.isAfter(now)) {
                return new StoredAttempt(
                        tenantId,
                        hotelId,
                        connectorId,
                        connectorVersionId,
                        authorizationAttemptId,
                        actorAccountId,
                        configVersion,
                        adapterCode,
                        adapterVersion,
                        AttemptState.EXPIRED,
                        requestedAt,
                        now,
                        expiresAt,
                        now,
                        rowVersion);
            }
            return this;
        }
    }

    public record AttemptView(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            UUID authorizationAttemptId,
            long configVersion,
            String adapterCode,
            String adapterVersion,
            String mode,
            AttemptState state,
            String authorizationState,
            Instant requestedAt,
            Instant changedAt,
            Instant expiresAt,
            Instant terminalAt,
            long rowVersion,
            boolean replayed,
            boolean runtimeBlocked,
            boolean pmsConnected,
            boolean browserStarted,
            boolean credentialsRead
    ) {
        public AttemptView {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(adapterCode, "adapterCode");
            Objects.requireNonNull(adapterVersion, "adapterVersion");
            Objects.requireNonNull(state, "state");
            Objects.requireNonNull(requestedAt, "requestedAt");
            Objects.requireNonNull(changedAt, "changedAt");
            Objects.requireNonNull(expiresAt, "expiresAt");
            if (!MODE.equals(mode)
                    || !AUTHORIZATION_STATE.equals(authorizationState)
                    || !runtimeBlocked
                    || pmsConnected
                    || browserStarted
                    || credentialsRead) {
                throw new IllegalArgumentException(
                        "Offline rehearsal safety invariants were violated");
            }
        }

        static AttemptView from(
                StoredAttempt attempt,
                boolean replayed,
                Instant now
        ) {
            StoredAttempt effective = attempt.effectiveAt(now);
            return new AttemptView(
                    effective.tenantId(),
                    effective.hotelId(),
                    effective.connectorId(),
                    effective.connectorVersionId(),
                    effective.authorizationAttemptId(),
                    effective.configVersion(),
                    effective.adapterCode(),
                    effective.adapterVersion(),
                    MODE,
                    effective.state(),
                    AUTHORIZATION_STATE,
                    effective.requestedAt(),
                    effective.changedAt(),
                    effective.expiresAt(),
                    effective.terminalAt(),
                    effective.rowVersion(),
                    replayed,
                    true,
                    false,
                    false,
                    false);
        }
    }

    public record StartCommand(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            ConnectorDraftBinding binding,
            UUID authorizationAttemptId,
            UUID actorAccountId,
            UUID trustedSessionId,
            CommandType commandType,
            UUID predecessorAttemptId,
            Long predecessorExpectedRowVersion,
            String idempotencyKey,
            String reasonCode,
            String requestHash,
            String interactionReferenceHash,
            Instant requestedAt,
            Instant expiresAt
    ) {
        public StartCommand {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(binding, "binding");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(trustedSessionId, "trustedSessionId");
            Objects.requireNonNull(commandType, "commandType");
            Objects.requireNonNull(idempotencyKey, "idempotencyKey");
            Objects.requireNonNull(reasonCode, "reasonCode");
            Objects.requireNonNull(requestHash, "requestHash");
            Objects.requireNonNull(
                    interactionReferenceHash,
                    "interactionReferenceHash");
            Objects.requireNonNull(requestedAt, "requestedAt");
            Objects.requireNonNull(expiresAt, "expiresAt");
            if (commandType != CommandType.START_REHEARSAL
                    && commandType != CommandType.REAUTHENTICATE_REHEARSAL) {
                throw new IllegalArgumentException(
                        "Start command type is invalid");
            }
            boolean reauthentication =
                    commandType == CommandType.REAUTHENTICATE_REHEARSAL;
            if (reauthentication != (predecessorAttemptId != null)
                    || reauthentication
                    != (predecessorExpectedRowVersion != null)
                    || (predecessorExpectedRowVersion != null
                    && predecessorExpectedRowVersion < 0)) {
                throw new IllegalArgumentException(
                        "Reauthentication requires a predecessor attempt");
            }
        }

        @Override
        public String toString() {
            return "StartCommand[scope=<redacted>"
                    + ", authorizationAttemptId=<redacted>"
                    + ", actorAccountId=<redacted>"
                    + ", trustedSessionId=<redacted>"
                    + ", commandType=" + commandType
                    + ", configVersion=" + binding.configVersion()
                    + "]";
        }
    }

    public record TransitionCommand(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId,
            UUID actorAccountId,
            UUID trustedSessionId,
            long expectedRowVersion,
            CommandType commandType,
            AttemptState targetState,
            String idempotencyKey,
            String reasonCode,
            String requestHash,
            Instant changedAt
    ) {
        public TransitionCommand {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(
                    authorizationAttemptId,
                    "authorizationAttemptId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(trustedSessionId, "trustedSessionId");
            Objects.requireNonNull(commandType, "commandType");
            Objects.requireNonNull(targetState, "targetState");
            Objects.requireNonNull(idempotencyKey, "idempotencyKey");
            Objects.requireNonNull(reasonCode, "reasonCode");
            Objects.requireNonNull(requestHash, "requestHash");
            Objects.requireNonNull(changedAt, "changedAt");
            if (expectedRowVersion < 0) {
                throw new IllegalArgumentException(
                        "expectedRowVersion must be non-negative");
            }
            boolean confirm = commandType == CommandType.CONFIRM_REHEARSAL
                    && targetState == AttemptState.OFFLINE_REHEARSAL_COMPLETE;
            boolean cancel = commandType == CommandType.CANCEL_REHEARSAL
                    && targetState == AttemptState.CANCELLED;
            if (!confirm && !cancel) {
                throw new IllegalArgumentException(
                        "Transition command and target state do not match");
            }
        }

        @Override
        public String toString() {
            return "TransitionCommand[scope=<redacted>"
                    + ", authorizationAttemptId=<redacted>"
                    + ", actorAccountId=<redacted>"
                    + ", trustedSessionId=<redacted>"
                    + ", commandType=" + commandType
                    + ", targetState=" + targetState
                    + ", expectedRowVersion=" + expectedRowVersion
                    + "]";
        }
    }

    public record PortResult(
            UUID commandId,
            StoredAttempt attempt,
            boolean replayed
    ) {
        public PortResult {
            Objects.requireNonNull(commandId, "commandId");
            Objects.requireNonNull(attempt, "attempt");
        }
    }
}
