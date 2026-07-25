package cn.sifangguan.ota.api.sprint2.intake;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;
import static org.assertj.core.api.Assertions.assertThat;

class JdbcConnectorIntakePortBoundaryTest {
    @Test
    void secretStatusReadCannotSelectOpaqueReferences() {
        assertThat(JdbcConnectorIntakePort.SECRET_STATUS_SQL)
                .contains(
                        "secret_purpose",
                        "provider_code",
                        "binding_status")
                .doesNotContain(
                        "secret_ref",
                        "secret_version",
                        "secret_fingerprint");
    }

    @Test
    void adapterHasNoOutboundClientOrRuntimeDispatcher() throws IOException {
        try (var input = getClass().getResourceAsStream(
                "/cn/sifangguan/ota/api/sprint2/intake/"
                        + "JdbcConnectorIntakePort.class")) {
            assertThat(input).isNotNull();
            String bytecode = new String(
                    input.readAllBytes(),
                    StandardCharsets.ISO_8859_1);
            assertThat(bytecode)
                    .contains("CONFIGURATION_ONLY")
                    .contains("hotel_source_connector_version")
                    .contains("ota_command_idempotency")
                    .contains("pg_advisory_xact_lock")
                    .doesNotContain("RestTemplate")
                    .doesNotContain("WebClient")
                    .doesNotContain("HttpClient")
                    .doesNotContain("connector_collection_schedule")
                    .doesNotContain("ota_job_registry");
        }
    }

    @Test
    void saveCreatesOnlyDraftConfigurationAndKeepsSecretOutOfJson()
            throws Exception {
        RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate();
        ObjectMapper objectMapper = new ObjectMapper();
        JdbcConnectorIntakePort port =
                new JdbcConnectorIntakePort(jdbc, objectMapper);
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        SaveDraftCommand command = new SaveDraftCommand(
                tenantId,
                hotelId,
                connectorId,
                actorId,
                SourceCode.CTRIP,
                "CTRIP_INTAKE",
                "CTRIP",
                "Ctrip",
                "Merchant Console",
                "2026",
                "CONTROLLED_BROWSER",
                "CTRIP_HOTEL_001",
                "hotel-account",
                "ROUTE_CTRIP",
                15,
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "VAULT",
                        "vault://ota/pilot/ctrip/session",
                        "v1")),
                0,
                "connector-intake-0001",
                "CONFIGURE_CTRIP",
                "a".repeat(64));

        var receipt = port.saveDraft(command);

        assertThat(receipt.resourceId()).isEqualTo(connectorId);
        assertThat(receipt.resultingRowVersion()).isZero();
        assertThat(receipt.replayed()).isFalse();

        SqlCall connector = jdbc.updateContaining(
                "insert into ota.hotel_source_connector(");
        assertThat(connector.sql())
                .contains("'CONFIGURATION_ONLY'", "'DRAFT'");

        SqlCall version = jdbc.updateContaining(
                "insert into ota.hotel_source_connector_version(");
        assertThat(version.sql())
                .contains("'DRAFT'", "null, null, null")
                .doesNotContain("'TESTED'", "'ACTIVE'");
        String storedJson = (String) version.arguments().get(7);
        JsonNode configuration = objectMapper.readTree(storedJson);
        Set<String> fieldNames = new java.util.HashSet<>();
        configuration.fieldNames().forEachRemaining(fieldNames::add);
        assertThat(fieldNames).containsExactlyInAnyOrder(
                "vendorCode",
                "vendorName",
                "productName",
                "productVersion",
                "connectionMethod",
                "externalHotelCode",
                "accountAlias",
                "networkRouteCode",
                "pollIntervalMinutes");
        assertThat(storedJson)
                .doesNotContain("vault://", "BROWSER_SESSION", "secret");
        assertThat((String) version.arguments().get(8))
                .matches("[a-f0-9]{64}");

        SqlCall secret = jdbc.updateContaining(
                "insert into ota.connector_secret_binding(");
        assertThat(secret.arguments().get(7))
                .isEqualTo("vault://ota/pilot/ctrip/session");
        assertThat(secret.arguments().get(9))
                .asString()
                .startsWith("sha256:")
                .doesNotContain("vault://");
        SqlCall idempotency = jdbc.updateContaining(
                "insert into ota.ota_command_idempotency(");
        assertThat(idempotency.arguments().get(4))
                .isEqualTo("SPRINT2_CONNECTOR_INTAKE_SAVE");
        assertThat(idempotency.arguments().get(9))
                .isEqualTo("DRAFT_SAVED");
        assertThat(jdbc.allSql())
                .noneMatch(sql -> sql.contains("connector_collection_schedule")
                        || sql.contains("ota_job_registry")
                        || sql.contains("connector_collection_run"));
    }

    @Test
    void nonSecretEditRetainsRequiredBindingWithoutReturningItsReference() {
        RecordingJdbcTemplate jdbc = new RecordingJdbcTemplate();
        JdbcConnectorIntakePort port =
                new JdbcConnectorIntakePort(jdbc, new ObjectMapper());
        SaveDraftCommand command = new SaveDraftCommand(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                SourceCode.CTRIP,
                "CTRIP_INTAKE",
                "CTRIP",
                "Ctrip",
                "Merchant Console",
                "2026",
                "CONTROLLED_BROWSER",
                "CTRIP_HOTEL_001",
                "hotel-account",
                "ROUTE_CTRIP",
                15,
                List.of(),
                0,
                "connector-intake-retain-0001",
                "UPDATE_CTRIP_CONFIG",
                "b".repeat(64));

        port.saveDraft(command);

        SqlCall retained = jdbc.updateContaining(
                "from ota.connector_secret_binding previous");
        assertThat(retained.sql())
                .contains(
                        "previous.secret_ref",
                        "previous.secret_version",
                        "previous.secret_fingerprint",
                        "candidate.version_no < ?");
        assertThat(JdbcConnectorIntakePort.SECRET_STATUS_SQL)
                .doesNotContain(
                        "secret_ref",
                        "secret_version",
                        "secret_fingerprint");
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final List<String> queries = new ArrayList<>();
        private final List<SqlCall> updates = new ArrayList<>();

        @Override
        public <T> List<T> query(
                String sql,
                RowMapper<T> rowMapper,
                Object... arguments
        ) {
            queries.add(sql);
            if (sql.contains("ota_command_idempotency")
                    || sql.contains("select connector_id")
                    || sql.contains("select source_type")) {
                return List.of();
            }
            throw new AssertionError("Unexpected query: " + sql);
        }

        @Override
        public <T> T queryForObject(
                String sql,
                Class<T> requiredType,
                Object... arguments
        ) {
            queries.add(sql);
            if (sql.contains("pg_advisory_xact_lock")) {
                return null;
            }
            if (sql.contains("select exists")) {
                return requiredType.cast(Boolean.TRUE);
            }
            if (sql.contains("coalesce(max(version_no), 0) + 1")) {
                return requiredType.cast(Long.valueOf(1));
            }
            throw new AssertionError("Unexpected queryForObject: " + sql);
        }

        @Override
        public int update(String sql, Object... arguments) {
            updates.add(new SqlCall(
                    sql,
                    Arrays.asList(arguments.clone())));
            return 1;
        }

        private SqlCall updateContaining(String fragment) {
            return updates.stream()
                    .filter(call -> call.sql().contains(fragment))
                    .findFirst()
                    .orElseThrow();
        }

        private List<String> allSql() {
            return java.util.stream.Stream.concat(
                            queries.stream(),
                            updates.stream().map(SqlCall::sql))
                    .collect(Collectors.toList());
        }
    }

    private record SqlCall(String sql, List<Object> arguments) {
    }
}
