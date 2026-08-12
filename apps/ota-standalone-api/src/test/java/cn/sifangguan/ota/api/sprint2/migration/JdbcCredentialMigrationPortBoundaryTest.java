package cn.sifangguan.ota.api.sprint2.migration;

import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JdbcCredentialMigrationPortBoundaryTest {
    @Test
    void bindingReadSelectsMetadataButNeverSecretReference() {
        assertThat(JdbcCredentialMigrationPort.BINDING_METADATA_SQL)
                .contains(
                        "binding_id",
                        "provider_code",
                        "secret_version",
                        "secret_fingerprint",
                        "row_version")
                .doesNotContain("secret_ref");
        assertThat(JdbcCredentialMigrationPort.LIST_SQL)
                .contains("credential_migration_rehearsal")
                .doesNotContain("secret_ref", "non_secret_config");
    }

    @Test
    void adapterHasNoOutboundClientSecretResolutionOrRuntimeDispatcher()
            throws IOException {
        try (var input = getClass().getResourceAsStream(
                "/cn/sifangguan/ota/api/sprint2/migration/"
                        + "JdbcCredentialMigrationPort.class")) {
            assertThat(input).isNotNull();
            String bytecode = new String(
                    input.readAllBytes(),
                    StandardCharsets.ISO_8859_1);
            assertThat(bytecode)
                    .contains("METADATA_REHEARSAL_READY")
                    .contains("raw_secret_received")
                    .contains("execution_allowed")
                    .doesNotContain("secret_ref")
                    .doesNotContain("RestTemplate")
                    .doesNotContain("WebClient")
                    .doesNotContain("HttpClient")
                    .doesNotContain("SecretStorePort")
                    .doesNotContain("connector_collection_schedule")
                    .doesNotContain("ota_job_registry");
        }
    }

    @Test
    void prepareChecksBindingVersionAndPersistsOnlyMetadataReceipt()
            throws SQLException {
        RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate(4);
        JdbcCredentialMigrationPort port = new JdbcCredentialMigrationPort(jdbc);
        PrepareCommand command = command(4);

        var receipt = port.prepare(command);

        assertThat(receipt.replayed()).isFalse();
        assertThat(jdbc.updates).hasSize(2);
        SqlCall rehearsal = jdbc.updates.getFirst();
        assertThat(rehearsal.sql())
                .contains(
                        "METADATA_ONLY",
                        "METADATA_REHEARSAL_READY",
                        "raw_secret_received",
                        "execution_allowed")
                .doesNotContain("secret_ref");
        assertThat(rehearsal.arguments())
                .contains(
                        command.sourceLocatorHash(),
                        command.targetSecretFingerprint())
                .doesNotContain(
                        "password",
                        "cookie",
                        "token",
                        "vault://ota/example");
        SqlCall idempotency = jdbc.updates.get(1);
        assertThat(idempotency.sql())
                .contains("ota.ota_command_idempotency");
        assertThat(idempotency.arguments())
                .contains(
                        "WP2_CREDENTIAL_MIGRATION_PREPARE",
                        "CREDENTIAL_MIGRATION_REHEARSAL",
                        "METADATA_REHEARSAL_READY");
    }

    @Test
    void prepareRejectsStaleBindingVersionBeforeAnyWrite() throws SQLException {
        RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate(5);
        JdbcCredentialMigrationPort port = new JdbcCredentialMigrationPort(jdbc);

        assertThatThrownBy(() -> port.prepare(command(4)))
                .isInstanceOf(RowVersionConflictException.class);
        assertThat(jdbc.updates).isEmpty();
    }

    private static PrepareCommand command(long expectedVersion) {
        return new PrepareCommand(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                expectedVersion,
                "SOURCE_AUTH",
                "LEGACY_CLOUD_SERVICE",
                "a".repeat(64),
                "VAULT",
                "v2",
                "sha256:" + "b".repeat(64),
                "PREPARE_METADATA_REHEARSAL",
                "credential-migration-0001",
                "c".repeat(64));
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final long storedBindingVersion;
        private final List<SqlCall> updates = new ArrayList<>();

        private RecordingJdbcTemplate(long storedBindingVersion) {
            this.storedBindingVersion = storedBindingVersion;
        }

        @Override
        public <T> List<T> query(
                String sql,
                RowMapper<T> rowMapper,
                Object... arguments
        ) {
            if (sql.contains("ota_command_idempotency")) {
                return List.of();
            }
            if (!sql.equals(JdbcCredentialMigrationPort.BINDING_METADATA_SQL)) {
                throw new AssertionError("Unexpected query: " + sql);
            }
            try {
                ResultSet result = mock(ResultSet.class);
                when(result.getObject("binding_id", UUID.class))
                        .thenReturn(UUID.randomUUID());
                when(result.getString("provider_code")).thenReturn("VAULT");
                when(result.getString("secret_version")).thenReturn("v2");
                when(result.getString("secret_fingerprint"))
                        .thenReturn("sha256:" + "b".repeat(64));
                when(result.getLong("row_version"))
                        .thenReturn(storedBindingVersion);
                return List.of(rowMapper.mapRow(result, 0));
            } catch (SQLException exception) {
                throw new AssertionError(exception);
            }
        }

        @Override
        public <T> T queryForObject(
                String sql,
                Class<T> requiredType,
                Object... arguments
        ) {
            if (!sql.contains("pg_advisory_xact_lock")) {
                throw new AssertionError("Unexpected scalar query: " + sql);
            }
            return null;
        }

        @Override
        public int update(String sql, Object... arguments) {
            updates.add(new SqlCall(sql, List.of(arguments)));
            return 1;
        }
    }

    private record SqlCall(String sql, List<Object> arguments) {
    }
}
