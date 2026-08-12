package cn.sifangguan.ota.api.sprint2.migration;

import cn.sifangguan.ota.api.sprint1.application.IdempotencyConflictException;
import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;

public final class JdbcCredentialMigrationPort implements CredentialMigrationPort {
    private static final String COMMAND_TYPE =
            "WP2_CREDENTIAL_MIGRATION_PREPARE";
    private static final String RESOURCE_TYPE =
            "CREDENTIAL_MIGRATION_REHEARSAL";
    private static final String RESULT_CODE =
            "METADATA_REHEARSAL_READY";

    /**
     * Intentionally excludes connector_secret_binding.secret_ref.
     */
    static final String BINDING_METADATA_SQL = """
            select binding_id, provider_code, secret_version,
                   secret_fingerprint, row_version
              from ota.connector_secret_binding
             where hotel_id = ?
               and connector_id = ?
               and connector_version_id = ?
               and secret_purpose = ?
               and binding_status = 'CONFIGURED'
            """;

    static final String LIST_SQL = """
            select tenant_id, hotel_id, connector_id, connector_version_id,
                   migration_rehearsal_id, secret_purpose,
                   source_system_code, source_locator_hash,
                   target_provider_code, target_secret_version,
                   target_secret_fingerprint, rehearsal_state,
                   execution_allowed, row_version
              from ota.credential_migration_rehearsal
             where hotel_id = ? and connector_id = ?
             order by created_at, migration_rehearsal_id
            """;

    private final JdbcTemplate jdbc;

    public JdbcCredentialMigrationPort(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
    }

    @Override
    public List<RehearsalView> list(UUID hotelId, UUID connectorId) {
        return jdbc.query(
                LIST_SQL,
                JdbcCredentialMigrationPort::mapView,
                hotelId,
                connectorId);
    }

    @Override
    public Receipt prepare(PrepareCommand command) {
        advisoryLock(
                command.tenantId(),
                command.hotelId(),
                "CREDENTIAL_MIGRATION|" + command.connectorId()
                        + "|" + command.secretPurpose());
        advisoryLock(
                command.tenantId(),
                command.hotelId(),
                "IDEMPOTENCY|" + command.idempotencyKey());

        Optional<CommandRow> previous = commandReceipt(
                command.hotelId(), command.idempotencyKey());
        if (previous.isPresent()) {
            return replay(command, previous.orElseThrow());
        }

        BindingMetadata binding = jdbc.query(
                        BINDING_METADATA_SQL,
                        JdbcCredentialMigrationPort::mapBinding,
                        command.hotelId(),
                        command.connectorId(),
                        command.connectorVersionId(),
                        command.secretPurpose())
                .stream()
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException(
                        "Configured target binding metadata was not found"));
        if (binding.rowVersion() != command.expectedBindingRowVersion()) {
            throw new RowVersionConflictException();
        }
        if (!binding.providerCode().equals(command.targetProviderCode())
                || !binding.secretVersion().equals(command.targetSecretVersion())
                || !binding.secretFingerprint().equalsIgnoreCase(
                command.targetSecretFingerprint())) {
            throw new IllegalArgumentException(
                    "Target binding metadata does not match the stored binding");
        }

        UUID rehearsalId = stableId(
                "WP2_CREDENTIAL_MIGRATION_REHEARSAL",
                command.requestHash());
        jdbc.update("""
                        insert into ota.credential_migration_rehearsal(
                            tenant_id, hotel_id, connector_id,
                            connector_version_id, migration_rehearsal_id,
                            target_binding_id, secret_purpose,
                            source_system_code, source_locator_hash,
                            target_provider_code, target_secret_version,
                            target_secret_fingerprint, migration_mode,
                            rehearsal_state, raw_secret_received,
                            execution_allowed, planned_by_account_id,
                            reason_code
                        ) values (
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            'METADATA_ONLY', 'METADATA_REHEARSAL_READY',
                            false, false, ?, ?
                        )
                        """,
                command.tenantId(),
                command.hotelId(),
                command.connectorId(),
                command.connectorVersionId(),
                rehearsalId,
                binding.bindingId(),
                command.secretPurpose(),
                command.sourceSystemCode(),
                command.sourceLocatorHash(),
                command.targetProviderCode(),
                command.targetSecretVersion(),
                command.targetSecretFingerprint(),
                command.actorAccountId(),
                command.reasonCode());

        UUID commandId = UUID.randomUUID();
        jdbc.update("""
                        insert into ota.ota_command_idempotency(
                            tenant_id, hotel_id, command_id, idempotency_key,
                            command_type, request_hash, resource_type,
                            resource_id, resulting_row_version, result_code
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                        """,
                command.tenantId(),
                command.hotelId(),
                commandId,
                command.idempotencyKey(),
                COMMAND_TYPE,
                command.requestHash(),
                RESOURCE_TYPE,
                rehearsalId,
                RESULT_CODE);
        return new Receipt(commandId.toString(), rehearsalId, false);
    }

    private Optional<CommandRow> commandReceipt(UUID hotelId, String key) {
        return jdbc.query("""
                        select command_id, command_type, request_hash,
                               resource_type, resource_id, result_code
                          from ota.ota_command_idempotency
                         where hotel_id = ? and idempotency_key = ?
                        """,
                (resultSet, rowNumber) -> new CommandRow(
                        resultSet.getObject("command_id", UUID.class),
                        resultSet.getString("command_type"),
                        resultSet.getString("request_hash"),
                        resultSet.getString("resource_type"),
                        resultSet.getObject("resource_id", UUID.class),
                        resultSet.getString("result_code")),
                hotelId,
                key).stream().findFirst();
    }

    private static Receipt replay(PrepareCommand command, CommandRow existing) {
        if (!COMMAND_TYPE.equals(existing.commandType())
                || !RESOURCE_TYPE.equals(existing.resourceType())
                || !RESULT_CODE.equals(existing.resultCode())
                || !command.requestHash().equalsIgnoreCase(existing.requestHash())) {
            throw new IdempotencyConflictException();
        }
        return new Receipt(
                existing.commandId().toString(),
                existing.resourceId(),
                true);
    }

    private void advisoryLock(UUID tenantId, UUID hotelId, String key) {
        jdbc.queryForObject("""
                        select pg_advisory_xact_lock(
                            hashtextextended(cast(? as text), 0)
                        )
                        """,
                Object.class,
                tenantId + "|" + hotelId + "|" + key);
    }

    private static BindingMetadata mapBinding(
            ResultSet resultSet,
            int rowNumber
    ) throws SQLException {
        return new BindingMetadata(
                resultSet.getObject("binding_id", UUID.class),
                resultSet.getString("provider_code"),
                resultSet.getString("secret_version"),
                resultSet.getString("secret_fingerprint"),
                resultSet.getLong("row_version"));
    }

    private static RehearsalView mapView(
            ResultSet resultSet,
            int rowNumber
    ) throws SQLException {
        return new RehearsalView(
                resultSet.getObject("tenant_id", UUID.class),
                resultSet.getObject("hotel_id", UUID.class),
                resultSet.getObject("connector_id", UUID.class),
                resultSet.getObject("connector_version_id", UUID.class),
                resultSet.getObject("migration_rehearsal_id", UUID.class),
                resultSet.getString("secret_purpose"),
                resultSet.getString("source_system_code"),
                resultSet.getString("source_locator_hash"),
                resultSet.getString("target_provider_code"),
                resultSet.getString("target_secret_version"),
                resultSet.getString("target_secret_fingerprint"),
                resultSet.getString("rehearsal_state"),
                resultSet.getBoolean("execution_allowed"),
                resultSet.getLong("row_version"));
    }

    private static UUID stableId(String... parts) {
        return UUID.nameUUIDFromBytes(
                String.join("|", parts).getBytes(StandardCharsets.UTF_8));
    }

    private record BindingMetadata(
            UUID bindingId,
            String providerCode,
            String secretVersion,
            String secretFingerprint,
            long rowVersion
    ) {
    }

    private record CommandRow(
            UUID commandId,
            String commandType,
            String requestHash,
            String resourceType,
            UUID resourceId,
            String resultCode
    ) {
    }
}
