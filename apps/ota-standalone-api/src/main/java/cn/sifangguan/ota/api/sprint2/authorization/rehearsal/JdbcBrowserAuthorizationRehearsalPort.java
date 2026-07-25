package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptState;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.CommandType;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.ConnectorDraftBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.PortResult;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;

public final class JdbcBrowserAuthorizationRehearsalPort
        implements BrowserAuthorizationRehearsalPort {
    private final JdbcTemplate jdbc;

    public JdbcBrowserAuthorizationRehearsalPort(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
    }

    @Override
    public Optional<ConnectorDraftBinding> findConnectorDraft(
            UUID hotelId,
            UUID connectorId
    ) {
        try {
            return jdbc.query("""
                            select connector.tenant_id,
                                   connector.hotel_id,
                                   connector.connector_id,
                                   version.connector_version_id,
                                   connector.row_version as config_version,
                                   connector.source_type,
                                   connector.adapter_code,
                                   version.adapter_version,
                                   version.non_secret_config ->> 'connectionMethod'
                                       as connection_method,
                                   exists (
                                       select 1
                                         from ota.connector_secret_binding binding
                                        where binding.tenant_id = connector.tenant_id
                                          and binding.hotel_id = connector.hotel_id
                                          and binding.connector_id = connector.connector_id
                                          and binding.connector_version_id =
                                              version.connector_version_id
                                          and binding.secret_purpose =
                                              'BROWSER_SESSION'
                                          and binding.binding_status =
                                              'CONFIGURED'
                                   ) as browser_reference_configured,
                                   (
                                       connector.connector_mode =
                                           'CONFIGURATION_ONLY'
                                       and connector.lifecycle_status = 'DRAFT'
                                       and version.status = 'DRAFT'
                                   ) as runtime_blocked
                              from ota.hotel_source_connector connector
                              join lateral (
                                  select candidate.*
                                    from ota.hotel_source_connector_version candidate
                                   where candidate.tenant_id = connector.tenant_id
                                     and candidate.hotel_id = connector.hotel_id
                                     and candidate.connector_id =
                                         connector.connector_id
                                   order by candidate.version_no desc
                                   limit 1
                              ) version on true
                             where connector.hotel_id = ?
                               and connector.connector_id = ?
                            """,
                    (resultSet, rowNumber) -> new ConnectorDraftBinding(
                            resultSet.getObject("tenant_id", UUID.class),
                            resultSet.getObject("hotel_id", UUID.class),
                            resultSet.getObject("connector_id", UUID.class),
                            resultSet.getObject(
                                    "connector_version_id",
                                    UUID.class),
                            resultSet.getLong("config_version"),
                            resultSet.getString("source_type"),
                            resultSet.getString("adapter_code"),
                            resultSet.getString("adapter_version"),
                            Optional.ofNullable(resultSet.getString(
                                            "connection_method"))
                                    .orElse("UNCONFIGURED"),
                            resultSet.getBoolean(
                                    "browser_reference_configured"),
                            resultSet.getBoolean("runtime_blocked")),
                    hotelId,
                    connectorId).stream().findFirst();
        } catch (DataAccessException exception) {
            throw map(exception);
        }
    }

    @Override
    public Optional<StoredAttempt> findAttempt(
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId
    ) {
        try {
            return jdbc.query("""
                            select tenant_id,
                                   hotel_id,
                                   connector_id,
                                   connector_version_id,
                                   authorization_attempt_id,
                                   actor_account_id,
                                   config_version,
                                   adapter_code,
                                   adapter_version,
                                   state_code,
                                   requested_at,
                                   changed_at,
                                   expires_at,
                                   terminal_at,
                                   row_version
                              from ota.browser_authorization_attempt
                             where hotel_id = ?
                               and connector_id = ?
                               and authorization_attempt_id = ?
                            """,
                    JdbcBrowserAuthorizationRehearsalPort::mapAttempt,
                    hotelId,
                    connectorId,
                    authorizationAttemptId).stream().findFirst();
        } catch (DataAccessException exception) {
            throw map(exception);
        }
    }

    @Override
    public Optional<StoredAttempt> findLatestAttempt(
            UUID hotelId,
            UUID connectorId
    ) {
        try {
            return jdbc.query("""
                            select tenant_id,
                                   hotel_id,
                                   connector_id,
                                   connector_version_id,
                                   authorization_attempt_id,
                                   actor_account_id,
                                   config_version,
                                   adapter_code,
                                   adapter_version,
                                   state_code,
                                   requested_at,
                                   changed_at,
                                   expires_at,
                                   terminal_at,
                                   row_version
                              from ota.browser_authorization_attempt
                             where hotel_id = ?
                               and connector_id = ?
                             order by requested_at desc,
                                      authorization_attempt_id desc
                             limit 1
                            """,
                    JdbcBrowserAuthorizationRehearsalPort::mapAttempt,
                    hotelId,
                    connectorId).stream().findFirst();
        } catch (DataAccessException exception) {
            throw map(exception);
        }
    }

    @Override
    public PortResult start(StartCommand command) {
        try {
            bindAuthenticatedPrincipal(
                    command.actorAccountId(),
                    command.trustedSessionId());
            Optional<CommandReceiptRow> existing = receipt(
                    command.hotelId(),
                    command.idempotencyKey());
            if (existing.isPresent()) {
                return replayStart(command, existing.orElseThrow());
            }
            UUID commandId = UUID.randomUUID();
            List<StoredAttempt> result = jdbc.query("""
                            select *
                              from ota.start_browser_authorization_rehearsal(
                                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                                  ?, ?
                              )
                            """,
                    JdbcBrowserAuthorizationRehearsalPort::mapAttempt,
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    command.binding().connectorVersionId(),
                    command.authorizationAttemptId(),
                    command.actorAccountId(),
                    command.binding().configVersion(),
                    command.binding().adapterCode(),
                    command.binding().adapterVersion(),
                    command.interactionReferenceHash(),
                    Timestamp.from(command.expiresAt()),
                    commandId,
                    command.idempotencyKey(),
                    command.requestHash(),
                    command.reasonCode(),
                    command.predecessorAttemptId(),
                    command.predecessorExpectedRowVersion());
            if (result.size() != 1) {
                throw new IllegalStateException(
                        "Offline rehearsal start returned no exact result");
            }
            return new PortResult(commandId, result.getFirst(), false);
        } catch (BrowserAuthorizationRehearsalConflictException
                 | SecurityException exception) {
            throw exception;
        } catch (DataAccessException exception) {
            throw map(exception);
        }
    }

    @Override
    public PortResult transition(TransitionCommand command) {
        try {
            bindAuthenticatedPrincipal(
                    command.actorAccountId(),
                    command.trustedSessionId());
            Optional<CommandReceiptRow> existing = receipt(
                    command.hotelId(),
                    command.idempotencyKey());
            if (existing.isPresent()) {
                return replayTransition(command, existing.orElseThrow());
            }
            StoredAttempt current = findAttempt(
                    command.hotelId(),
                    command.connectorId(),
                    command.authorizationAttemptId())
                    .orElseThrow(
                            BrowserAuthorizationRehearsalNotFoundException::new);
            UUID commandId = UUID.randomUUID();
            List<StoredAttempt> result = jdbc.query("""
                            select *
                              from ota.transition_browser_authorization_rehearsal(
                                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
                              )
                            """,
                    JdbcBrowserAuthorizationRehearsalPort::mapAttempt,
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    current.connectorVersionId(),
                    command.authorizationAttemptId(),
                    command.actorAccountId(),
                    current.configVersion(),
                    current.adapterCode(),
                    current.adapterVersion(),
                    command.expectedRowVersion(),
                    command.targetState().name(),
                    commandId,
                    command.idempotencyKey(),
                    command.requestHash(),
                    command.reasonCode());
            if (result.size() != 1) {
                throw new IllegalStateException(
                        "Offline rehearsal transition returned no exact result");
            }
            return new PortResult(commandId, result.getFirst(), false);
        } catch (BrowserAuthorizationRehearsalConflictException
                 | BrowserAuthorizationRehearsalNotFoundException
                 | SecurityException exception) {
            throw exception;
        } catch (DataAccessException exception) {
            throw map(exception);
        }
    }

    private PortResult replayStart(
            StartCommand command,
            CommandReceiptRow receipt
    ) {
        if (!"START".equals(receipt.commandType())
                || !receipt.connectorId().equals(command.connectorId())
                || !receipt.requestHash().equalsIgnoreCase(
                command.requestHash())
                || !receipt.actorAccountId().equals(
                command.actorAccountId())
                || !Objects.equals(
                receipt.predecessorAuthorizationAttemptId(),
                command.predecessorAttemptId())
                || !Objects.equals(
                receipt.predecessorExpectedRowVersion(),
                command.predecessorExpectedRowVersion())
                || !receipt.reasonCode().equals(command.reasonCode())) {
            throw new BrowserAuthorizationRehearsalConflictException(
                    "IDEMPOTENCY_KEY_CONFLICT");
        }
        StoredAttempt attempt = findAttempt(
                command.hotelId(),
                command.connectorId(),
                receipt.authorizationAttemptId())
                .orElseThrow(
                        BrowserAuthorizationRehearsalNotFoundException::new);
        requireStartReplayBinding(command, attempt);
        return new PortResult(receipt.commandId(), attempt, true);
    }

    private PortResult replayTransition(
            TransitionCommand command,
            CommandReceiptRow receipt
    ) {
        String expectedCommandType = switch (command.commandType()) {
            case CONFIRM_REHEARSAL -> "COMPLETE_REHEARSAL";
            case CANCEL_REHEARSAL -> "CANCEL";
            default -> throw new IllegalArgumentException(
                    "Transition command type is invalid");
        };
        if (!expectedCommandType.equals(receipt.commandType())
                || !receipt.connectorId().equals(command.connectorId())
                || !receipt.authorizationAttemptId().equals(
                command.authorizationAttemptId())
                || !receipt.requestHash().equalsIgnoreCase(
                command.requestHash())
                || !receipt.actorAccountId().equals(
                command.actorAccountId())
                || !receipt.reasonCode().equals(command.reasonCode())) {
            throw new BrowserAuthorizationRehearsalConflictException(
                    "IDEMPOTENCY_KEY_CONFLICT");
        }
        StoredAttempt attempt = findAttempt(
                command.hotelId(),
                command.connectorId(),
                command.authorizationAttemptId())
                .orElseThrow(
                        BrowserAuthorizationRehearsalNotFoundException::new);
        return new PortResult(receipt.commandId(), attempt, true);
    }

    private static void requireStartReplayBinding(
            StartCommand command,
            StoredAttempt attempt
    ) {
        if (!attempt.tenantId().equals(command.tenantId())
                || !attempt.hotelId().equals(command.hotelId())
                || !attempt.connectorId().equals(command.connectorId())
                || !attempt.connectorVersionId().equals(
                command.binding().connectorVersionId())
                || !attempt.actorAccountId().equals(
                command.actorAccountId())
                || attempt.configVersion()
                != command.binding().configVersion()
                || !attempt.adapterCode().equals(
                command.binding().adapterCode())
                || !attempt.adapterVersion().equals(
                command.binding().adapterVersion())) {
            throw new SecurityException(
                    "Idempotent rehearsal binding does not match");
        }
    }

    private Optional<CommandReceiptRow> receipt(
            UUID hotelId,
            String idempotencyKey
    ) {
        return jdbc.query("""
                        select command_id,
                               connector_id,
                               authorization_attempt_id,
                               command_type,
                               request_hash,
                               actor_account_id,
                               predecessor_authorization_attempt_id,
                               predecessor_expected_row_version,
                               reason_code
                          from ota.browser_authorization_command_receipt
                         where hotel_id = ?
                           and idempotency_key = ?
                        """,
                (resultSet, rowNumber) -> new CommandReceiptRow(
                        resultSet.getObject("command_id", UUID.class),
                        resultSet.getObject("connector_id", UUID.class),
                        resultSet.getObject(
                                "authorization_attempt_id",
                                UUID.class),
                        resultSet.getString("command_type"),
                        resultSet.getString("request_hash"),
                        resultSet.getObject("actor_account_id", UUID.class),
                        resultSet.getObject(
                                "predecessor_authorization_attempt_id",
                                UUID.class),
                        resultSet.getObject(
                                "predecessor_expected_row_version",
                                Long.class),
                        resultSet.getString("reason_code")),
                hotelId,
                idempotencyKey).stream().findFirst();
    }

    void bindAuthenticatedPrincipal(
            UUID actorAccountId,
            UUID trustedSessionId
    ) {
        if (actorAccountId == null || trustedSessionId == null) {
            throw new SecurityException(
                    "Authenticated principal context is required");
        }
        String confirmedActor = jdbc.queryForObject(
                "select set_config('app.account_id', ?, true)",
                String.class,
                actorAccountId.toString());
        if (!actorAccountId.toString().equals(confirmedActor)) {
            throw new SecurityException(
                    "Database actor context was not established");
        }
        String confirmedSession = jdbc.queryForObject(
                "select set_config('app.auth_session_id', ?, true)",
                String.class,
                trustedSessionId.toString());
        if (!trustedSessionId.toString().equals(confirmedSession)) {
            throw new SecurityException(
                    "Database authenticated session context was not established");
        }
    }

    private static StoredAttempt mapAttempt(
            ResultSet resultSet,
            int rowNumber
    ) throws SQLException {
        Timestamp terminalAt = resultSet.getTimestamp("terminal_at");
        return new StoredAttempt(
                resultSet.getObject("tenant_id", UUID.class),
                resultSet.getObject("hotel_id", UUID.class),
                resultSet.getObject("connector_id", UUID.class),
                resultSet.getObject("connector_version_id", UUID.class),
                resultSet.getObject(
                        "authorization_attempt_id",
                        UUID.class),
                resultSet.getObject("actor_account_id", UUID.class),
                resultSet.getLong("config_version"),
                resultSet.getString("adapter_code"),
                resultSet.getString("adapter_version"),
                AttemptState.valueOf(resultSet.getString("state_code")),
                resultSet.getTimestamp("requested_at").toInstant(),
                resultSet.getTimestamp("changed_at").toInstant(),
                resultSet.getTimestamp("expires_at").toInstant(),
                terminalAt == null ? null : terminalAt.toInstant(),
                resultSet.getLong("row_version"));
    }

    private static RuntimeException map(DataAccessException exception) {
        Throwable cause = exception.getMostSpecificCause();
        String sqlState = cause instanceof SQLException sql
                ? sql.getSQLState()
                : null;
        String message = cause == null ? "" : Objects.toString(
                cause.getMessage(),
                "");
        if ("42501".equals(sqlState)) {
            return new SecurityException(
                    "Database rejected the authorization rehearsal binding");
        }
        if ("40001".equals(sqlState)) {
            return new BrowserAuthorizationRehearsalConflictException(
                    "AUTHORIZATION_ROW_VERSION_CHANGED");
        }
        if ("23505".equals(sqlState)) {
            String code = message.contains(
                    "uq_browser_authorization_attempt_active_connector")
                    ? "ACTIVE_REHEARSAL_ALREADY_EXISTS"
                    : "IDEMPOTENCY_KEY_CONFLICT";
            return new BrowserAuthorizationRehearsalConflictException(code);
        }
        if ("55000".equals(sqlState) || "22023".equals(sqlState)) {
            return new BrowserAuthorizationRehearsalConflictException(
                    "AUTHORIZATION_REHEARSAL_STATE_CHANGED");
        }
        return new BrowserAuthorizationRehearsalStorageException(exception);
    }

    private record CommandReceiptRow(
            UUID commandId,
            UUID connectorId,
            UUID authorizationAttemptId,
            String commandType,
            String requestHash,
            UUID actorAccountId,
            UUID predecessorAuthorizationAttemptId,
            Long predecessorExpectedRowVersion,
            String reasonCode
    ) {
    }
}
