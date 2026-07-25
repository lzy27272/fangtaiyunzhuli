package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.sprint1.application.IdempotencyConflictException;
import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingStatus;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

/**
 * PostgreSQL persistence for configuration-only connector intake.
 *
 * The caller supplies a transaction-scoped RLS tenant context. This adapter
 * never resolves or returns secret references, and it creates only DRAFT,
 * non-executable connector versions.
 */
public final class JdbcConnectorIntakePort implements ConnectorIntakePort {
    private static final String COMMAND_TYPE = "SPRINT2_CONNECTOR_INTAKE_SAVE";
    private static final String RESOURCE_TYPE = "CONNECTOR_INTAKE";
    private static final String RESULT_CODE = "DRAFT_SAVED";
    private static final String CONFIGURATION_ONLY = "CONFIGURATION_ONLY";
    private static final String DRAFT = "DRAFT";
    private static final String INTAKE_VERSION = "0.0.0-config-only";

    private static final String LIST_DRAFTS_SQL = """
            select connector.tenant_id,
                   connector.hotel_id,
                   connector.connector_id,
                   connector.source_type,
                   connector.adapter_code,
                   connector.row_version,
                   version.connector_version_id,
                   version.non_secret_config::text as non_secret_config
              from ota.hotel_source_connector connector
              join lateral (
                  select connector_version_id, non_secret_config
                    from ota.hotel_source_connector_version
                   where tenant_id = connector.tenant_id
                     and hotel_id = connector.hotel_id
                     and connector_id = connector.connector_id
                     and status = 'DRAFT'
                   order by version_no desc
                   limit 1
              ) version on true
             where connector.hotel_id = ?
               and connector.connector_mode = 'CONFIGURATION_ONLY'
               and connector.lifecycle_status = 'DRAFT'
             order by connector.source_type, connector.connector_id
            """;

    private static final String FIND_DRAFT_SQL = """
            select connector.tenant_id,
                   connector.hotel_id,
                   connector.connector_id,
                   connector.source_type,
                   connector.adapter_code,
                   connector.row_version,
                   version.connector_version_id,
                   version.non_secret_config::text as non_secret_config
              from ota.hotel_source_connector connector
              join lateral (
                  select connector_version_id, non_secret_config
                    from ota.hotel_source_connector_version
                   where tenant_id = connector.tenant_id
                     and hotel_id = connector.hotel_id
                     and connector_id = connector.connector_id
                     and status = 'DRAFT'
                   order by version_no desc
                   limit 1
              ) version on true
             where connector.hotel_id = ?
               and connector.source_type = ?
               and connector.connector_mode = 'CONFIGURATION_ONLY'
               and connector.lifecycle_status = 'DRAFT'
             order by connector.connector_id
            """;

    /**
     * Intentionally selects no secret_ref, secret_version or deterministic
     * fingerprint column.
     */
    static final String SECRET_STATUS_SQL = """
            select secret_purpose, provider_code, binding_status
              from ota.connector_secret_binding
             where hotel_id = ?
               and connector_id = ?
               and connector_version_id = ?
             order by secret_purpose
            """;

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public JdbcConnectorIntakePort(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper
    ) {
        this.jdbc = java.util.Objects.requireNonNull(jdbc, "jdbc");
        this.objectMapper = java.util.Objects.requireNonNull(objectMapper, "objectMapper");
    }

    @Override
    public List<ConnectorDraftView> listDrafts(UUID hotelId) {
        List<StoredDraft> rows = jdbc.query(
                LIST_DRAFTS_SQL,
                JdbcConnectorIntakePort::mapStoredDraft,
                hotelId);
        return rows.stream().map(this::toView).toList();
    }

    @Override
    public Optional<ConnectorDraftView> findDraft(
            UUID hotelId,
            SourceCode sourceCode
    ) {
        return jdbc.query(
                        FIND_DRAFT_SQL,
                        JdbcConnectorIntakePort::mapStoredDraft,
                        hotelId,
                        sourceCode.name())
                .stream()
                .findFirst()
                .map(this::toView);
    }

    @Override
    public CommandReceipt saveDraft(SaveDraftCommand command) {
        advisoryLock(
                command.tenantId(),
                command.hotelId(),
                "CONNECTOR_INTAKE|" + command.sourceCode().name());
        advisoryLock(
                command.tenantId(),
                command.hotelId(),
                "IDEMPOTENCY|" + command.idempotencyKey());

        Optional<CommandRow> previous =
                commandReceipt(command.hotelId(), command.idempotencyKey());
        if (previous.isPresent()) {
            return replay(command, previous.orElseThrow());
        }

        if (!hotelExists(command.hotelId())) {
            throw new IllegalArgumentException("Hotel does not exist");
        }
        rejectDuplicateSourceDraft(command);

        long resultingRowVersion = upsertConnector(command);
        long versionNo = nextVersionNo(command.hotelId(), command.connectorId());
        UUID connectorVersionId = stableId(
                "CONNECTOR_INTAKE_VERSION",
                command.tenantId().toString(),
                command.hotelId().toString(),
                command.connectorId().toString(),
                Long.toString(versionNo));
        String configuration = configurationJson(command);
        insertDraftVersion(
                command,
                connectorVersionId,
                versionNo,
                configuration);
        insertSecretBindings(command, connectorVersionId, versionNo);

        UUID commandId = stableId(
                "CONNECTOR_INTAKE_COMMAND",
                command.tenantId().toString(),
                command.hotelId().toString(),
                command.idempotencyKey());
        insertCommandReceipt(
                command,
                commandId,
                resultingRowVersion);
        return new CommandReceipt(
                commandId.toString(),
                command.connectorId(),
                resultingRowVersion,
                false);
    }

    private ConnectorDraftView toView(StoredDraft stored) {
        StoredConfiguration configuration = parseConfiguration(stored.configurationJson());
        List<SecretBindingStatus> configured = jdbc.query(
                SECRET_STATUS_SQL,
                (resultSet, rowNumber) -> new SecretBindingStatus(
                        resultSet.getString("secret_purpose"),
                        resultSet.getString("provider_code"),
                        !"REVOKED".equals(resultSet.getString("binding_status")),
                        resultSet.getString("binding_status")),
                stored.hotelId(),
                stored.connectorId(),
                stored.connectorVersionId());

        List<String> required = ConnectorIntakeTemplateDirectory.requiredPurposes(
                stored.sourceCode(),
                configuration.connectionMethod());
        Set<String> usablePurposes = configured.stream()
                .filter(SecretBindingStatus::configured)
                .map(SecretBindingStatus::purpose)
                .collect(java.util.stream.Collectors.toSet());
        List<String> missing = required.stream()
                .filter(purpose -> !usablePurposes.contains(purpose))
                .toList();

        List<SecretBindingStatus> statuses = new ArrayList<>(configured);
        for (String purpose : missing) {
            statuses.add(new SecretBindingStatus(
                    purpose,
                    "UNCONFIGURED",
                    false,
                    "NOT_CONFIGURED"));
        }
        statuses.sort(Comparator.comparing(SecretBindingStatus::purpose));

        List<String> blockers = new ArrayList<>();
        missing.forEach(purpose ->
                blockers.add("SECRET_" + purpose + "_NOT_CONFIGURED"));
        blockers.add("EXTERNAL_CONNECTOR_NOT_IMPLEMENTED");
        blockers.add("CONNECTION_TEST_BLOCKED");
        blockers.add("ACTIVATION_BLOCKED");
        blockers.add("RUNTIME_BLOCKED");

        return new ConnectorDraftView(
                stored.tenantId(),
                stored.hotelId(),
                stored.connectorId(),
                stored.sourceCode(),
                stored.templateCode(),
                configuration.vendorCode(),
                configuration.vendorName(),
                configuration.productName(),
                configuration.productVersion(),
                configuration.connectionMethod(),
                configuration.externalHotelCode(),
                configuration.accountAlias(),
                configuration.networkRouteCode(),
                configuration.pollIntervalMinutes(),
                statuses,
                stored.rowVersion(),
                DRAFT,
                missing.isEmpty()
                        ? "CONFIGURATION_CAPTURED_RUNTIME_BLOCKED"
                        : "DRAFT_INCOMPLETE",
                true,
                blockers);
    }

    private long upsertConnector(SaveDraftCommand command) {
        Optional<ExistingConnector> existing =
                findConnector(command.hotelId(), command.connectorId());
        if (existing.isEmpty()) {
            if (command.expectedRowVersion() != 0) {
                throw new RowVersionConflictException();
            }
            jdbc.update("""
                            insert into ota.hotel_source_connector(
                                tenant_id, hotel_id, connector_id, source_type,
                                adapter_code, connector_mode, lifecycle_status,
                                display_name
                            ) values (?, ?, ?, ?, ?, 'CONFIGURATION_ONLY', 'DRAFT', ?)
                            """,
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    command.sourceCode().name(),
                    command.templateCode(),
                    command.productName());
            return 0;
        }

        ExistingConnector current = existing.orElseThrow();
        if (!command.sourceCode().name().equals(current.sourceType())
                || !command.templateCode().equals(current.adapterCode())
                || !CONFIGURATION_ONLY.equals(current.connectorMode())
                || !DRAFT.equals(current.lifecycleStatus())) {
            throw new IllegalArgumentException(
                    "Connector identity does not match the intake draft");
        }
        if (current.rowVersion() != command.expectedRowVersion()) {
            throw new RowVersionConflictException();
        }
        int updated = jdbc.update("""
                        update ota.hotel_source_connector
                           set display_name = ?,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ?
                           and connector_id = ?
                           and connector_mode = 'CONFIGURATION_ONLY'
                           and lifecycle_status = 'DRAFT'
                           and row_version = ?
                        """,
                command.productName(),
                command.hotelId(),
                command.connectorId(),
                command.expectedRowVersion());
        if (updated != 1) {
            throw new RowVersionConflictException();
        }
        return command.expectedRowVersion() + 1;
    }

    private void rejectDuplicateSourceDraft(SaveDraftCommand command) {
        List<UUID> ids = jdbc.query("""
                        select connector_id
                          from ota.hotel_source_connector
                         where hotel_id = ?
                           and source_type = ?
                           and connector_mode = 'CONFIGURATION_ONLY'
                         order by connector_id
                        """,
                (resultSet, rowNumber) ->
                        resultSet.getObject("connector_id", UUID.class),
                command.hotelId(),
                command.sourceCode().name());
        if (ids.stream().anyMatch(id -> !id.equals(command.connectorId()))) {
            throw new IllegalArgumentException(
                    "A configuration-only draft already exists for this source");
        }
    }

    private Optional<ExistingConnector> findConnector(
            UUID hotelId,
            UUID connectorId
    ) {
        return jdbc.query("""
                        select source_type, adapter_code, connector_mode,
                               lifecycle_status, row_version
                          from ota.hotel_source_connector
                         where hotel_id = ? and connector_id = ?
                        """,
                (resultSet, rowNumber) -> new ExistingConnector(
                        resultSet.getString("source_type"),
                        resultSet.getString("adapter_code"),
                        resultSet.getString("connector_mode"),
                        resultSet.getString("lifecycle_status"),
                        resultSet.getLong("row_version")),
                hotelId,
                connectorId).stream().findFirst();
    }

    private long nextVersionNo(UUID hotelId, UUID connectorId) {
        Long result = jdbc.queryForObject("""
                        select coalesce(max(version_no), 0) + 1
                          from ota.hotel_source_connector_version
                         where hotel_id = ? and connector_id = ?
                        """,
                Long.class,
                hotelId,
                connectorId);
        if (result == null || result <= 0) {
            throw new IllegalStateException(
                    "Connector intake version number could not be allocated");
        }
        return result;
    }

    private void insertDraftVersion(
            SaveDraftCommand command,
            UUID connectorVersionId,
            long versionNo,
            String configuration
    ) {
        jdbc.update("""
                        insert into ota.hotel_source_connector_version(
                            tenant_id, hotel_id, connector_id, connector_version_id,
                            version_no, adapter_version, parser_version,
                            non_secret_config, capability_codes, config_hash,
                            status, tested_at, activated_at, retired_at,
                            created_by_account_id
                        ) values (?, ?, ?, ?, ?, ?, ?, cast(? as jsonb),
                                  array[]::text[], ?, 'DRAFT', null, null, null, ?)
                        """,
                command.tenantId(),
                command.hotelId(),
                command.connectorId(),
                connectorVersionId,
                versionNo,
                INTAKE_VERSION,
                INTAKE_VERSION,
                configuration,
                sha256(configuration),
                command.actorAccountId());
    }

    private void insertSecretBindings(
            SaveDraftCommand command,
            UUID connectorVersionId,
            long versionNo
    ) {
        Set<String> suppliedPurposes = command.secretBindings().stream()
                .map(SecretBindingInput::purpose)
                .collect(java.util.stream.Collectors.toSet());
        for (String purpose : ConnectorIntakeTemplateDirectory.requiredPurposes(
                command.sourceCode(),
                command.connectionMethod())) {
            if (!suppliedPurposes.contains(purpose)) {
                retainPreviousSecretBinding(
                        command,
                        connectorVersionId,
                        versionNo,
                        purpose);
            }
        }
        for (SecretBindingInput binding : command.secretBindings()) {
            UUID bindingId = stableId(
                    "CONNECTOR_INTAKE_SECRET_BINDING",
                    command.tenantId().toString(),
                    command.hotelId().toString(),
                    connectorVersionId.toString(),
                    binding.purpose());
            jdbc.update("""
                            insert into ota.connector_secret_binding(
                                tenant_id, hotel_id, connector_id,
                                connector_version_id, binding_id, secret_purpose,
                                provider_code, secret_ref, secret_version,
                                secret_fingerprint, binding_status
                            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIGURED')
                            """,
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    connectorVersionId,
                    bindingId,
                    binding.purpose(),
                    binding.providerCode(),
                    binding.opaqueSecretReference(),
                    binding.secretVersion(),
                    "sha256:" + sha256(binding.opaqueSecretReference()));
        }
    }

    private void retainPreviousSecretBinding(
            SaveDraftCommand command,
            UUID connectorVersionId,
            long versionNo,
            String purpose
    ) {
        UUID bindingId = stableId(
                "CONNECTOR_INTAKE_SECRET_BINDING",
                command.tenantId().toString(),
                command.hotelId().toString(),
                connectorVersionId.toString(),
                purpose);
        jdbc.update("""
                        insert into ota.connector_secret_binding(
                            tenant_id, hotel_id, connector_id,
                            connector_version_id, binding_id, secret_purpose,
                            provider_code, secret_ref, secret_version,
                            secret_fingerprint, binding_status,
                            configured_at, revoked_at, row_version
                        )
                        select previous.tenant_id,
                               previous.hotel_id,
                               previous.connector_id,
                               ?,
                               ?,
                               previous.secret_purpose,
                               previous.provider_code,
                               previous.secret_ref,
                               previous.secret_version,
                               previous.secret_fingerprint,
                               previous.binding_status,
                               previous.configured_at,
                               previous.revoked_at,
                               previous.row_version
                          from ota.connector_secret_binding previous
                          join ota.hotel_source_connector_version prior_version
                            on prior_version.tenant_id = previous.tenant_id
                           and prior_version.hotel_id = previous.hotel_id
                           and prior_version.connector_id = previous.connector_id
                           and prior_version.connector_version_id =
                               previous.connector_version_id
                         where previous.hotel_id = ?
                           and previous.connector_id = ?
                           and previous.secret_purpose = ?
                           and prior_version.version_no = (
                               select max(candidate.version_no)
                                 from ota.hotel_source_connector_version candidate
                                where candidate.hotel_id = ?
                                  and candidate.connector_id = ?
                                  and candidate.version_no < ?
                           )
                        """,
                connectorVersionId,
                bindingId,
                command.hotelId(),
                command.connectorId(),
                purpose,
                command.hotelId(),
                command.connectorId(),
                versionNo);
    }

    private String configurationJson(SaveDraftCommand command) {
        Map<String, Object> configuration = new LinkedHashMap<>();
        configuration.put("vendorCode", command.vendorCode());
        configuration.put("vendorName", command.vendorName());
        configuration.put("productName", command.productName());
        configuration.put("productVersion", command.productVersion());
        configuration.put("connectionMethod", command.connectionMethod());
        configuration.put("externalHotelCode", command.externalHotelCode());
        configuration.put("accountAlias", command.accountAlias());
        configuration.put("networkRouteCode", command.networkRouteCode());
        configuration.put("pollIntervalMinutes", command.pollIntervalMinutes());
        try {
            return objectMapper.writeValueAsString(configuration);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException(
                    "Connector intake configuration could not be serialized",
                    exception);
        }
    }

    private StoredConfiguration parseConfiguration(String value) {
        try {
            JsonNode node = objectMapper.readTree(value);
            return new StoredConfiguration(
                    requiredText(node, "vendorCode"),
                    requiredText(node, "vendorName"),
                    requiredText(node, "productName"),
                    optionalText(node, "productVersion"),
                    requiredText(node, "connectionMethod"),
                    requiredText(node, "externalHotelCode"),
                    optionalText(node, "accountAlias"),
                    requiredText(node, "networkRouteCode"),
                    node.path("pollIntervalMinutes").asInt(-1));
        } catch (JsonProcessingException | IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "Stored connector intake configuration is invalid",
                    exception);
        }
    }

    private Optional<CommandRow> commandReceipt(UUID hotelId, String key) {
        return jdbc.query("""
                        select command_id, command_type, request_hash,
                               resource_type, resource_id,
                               resulting_row_version, result_code
                          from ota.ota_command_idempotency
                         where hotel_id = ? and idempotency_key = ?
                        """,
                (resultSet, rowNumber) -> new CommandRow(
                        resultSet.getObject("command_id", UUID.class),
                        resultSet.getString("command_type"),
                        resultSet.getString("request_hash"),
                        resultSet.getString("resource_type"),
                        resultSet.getObject("resource_id", UUID.class),
                        resultSet.getObject("resulting_row_version", Long.class),
                        resultSet.getString("result_code")),
                hotelId,
                key).stream().findFirst();
    }

    private CommandReceipt replay(SaveDraftCommand command, CommandRow existing) {
        if (!COMMAND_TYPE.equals(existing.commandType())
                || !RESOURCE_TYPE.equals(existing.resourceType())
                || !RESULT_CODE.equals(existing.resultCode())
                || !command.requestHash().equalsIgnoreCase(existing.requestHash())
                || !command.connectorId().equals(existing.resourceId())) {
            throw new IdempotencyConflictException();
        }
        return new CommandReceipt(
                existing.commandId().toString(),
                existing.resourceId(),
                existing.resultingRowVersion() == null
                        ? 0
                        : existing.resultingRowVersion(),
                true);
    }

    private void insertCommandReceipt(
            SaveDraftCommand command,
            UUID commandId,
            long resultingRowVersion
    ) {
        jdbc.update("""
                        insert into ota.ota_command_idempotency(
                            tenant_id, hotel_id, command_id, idempotency_key,
                            command_type, request_hash, resource_type, resource_id,
                            resulting_row_version, result_code
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                command.tenantId(),
                command.hotelId(),
                commandId,
                command.idempotencyKey(),
                COMMAND_TYPE,
                command.requestHash(),
                RESOURCE_TYPE,
                command.connectorId(),
                resultingRowVersion,
                RESULT_CODE);
    }

    private void advisoryLock(
            UUID tenantId,
            UUID hotelId,
            String key
    ) {
        jdbc.queryForObject("""
                        select pg_advisory_xact_lock(
                            hashtextextended(cast(? as text), 0)
                        )
                        """,
                Object.class,
                tenantId + "|" + hotelId + "|" + key);
    }

    private boolean hotelExists(UUID hotelId) {
        return Boolean.TRUE.equals(jdbc.queryForObject("""
                        select exists (
                            select 1 from ota.hotel where hotel_id = ?
                        )
                        """,
                Boolean.class,
                hotelId));
    }

    private static StoredDraft mapStoredDraft(
            ResultSet resultSet,
            int rowNumber
    ) throws SQLException {
        return new StoredDraft(
                resultSet.getObject("tenant_id", UUID.class),
                resultSet.getObject("hotel_id", UUID.class),
                resultSet.getObject("connector_id", UUID.class),
                SourceCode.valueOf(resultSet.getString("source_type")),
                resultSet.getString("adapter_code"),
                resultSet.getLong("row_version"),
                resultSet.getObject("connector_version_id", UUID.class),
                resultSet.getString("non_secret_config"));
    }

    private static String requiredText(JsonNode node, String name) {
        JsonNode value = node.get(name);
        if (value == null || !value.isTextual() || value.textValue().isBlank()) {
            throw new IllegalArgumentException(name + " is missing");
        }
        return value.textValue();
    }

    private static String optionalText(JsonNode node, String name) {
        JsonNode value = node.get(name);
        if (value == null || value.isNull()) {
            return null;
        }
        if (!value.isTextual()) {
            throw new IllegalArgumentException(name + " is invalid");
        }
        return value.textValue();
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static UUID stableId(String... parts) {
        return UUID.nameUUIDFromBytes(
                String.join("|", parts).getBytes(StandardCharsets.UTF_8));
    }

    private record StoredDraft(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            SourceCode sourceCode,
            String templateCode,
            long rowVersion,
            UUID connectorVersionId,
            String configurationJson
    ) {
    }

    private record StoredConfiguration(
            String vendorCode,
            String vendorName,
            String productName,
            String productVersion,
            String connectionMethod,
            String externalHotelCode,
            String accountAlias,
            String networkRouteCode,
            int pollIntervalMinutes
    ) {
        private StoredConfiguration {
            if (pollIntervalMinutes <= 0) {
                throw new IllegalArgumentException(
                        "pollIntervalMinutes is invalid");
            }
        }
    }

    private record ExistingConnector(
            String sourceType,
            String adapterCode,
            String connectorMode,
            String lifecycleStatus,
            long rowVersion
    ) {
    }

    private record CommandRow(
            UUID commandId,
            String commandType,
            String requestHash,
            String resourceType,
            UUID resourceId,
            Long resultingRowVersion,
            String resultCode
    ) {
    }
}
