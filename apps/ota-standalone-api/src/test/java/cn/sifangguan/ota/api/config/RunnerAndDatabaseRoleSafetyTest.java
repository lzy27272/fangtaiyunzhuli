package cn.sifangguan.ota.api.config;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunnerAndDatabaseRoleSafetyTest {
    private static final String FLYWAY_HISTORY_TABLE = "flyway.flyway_schema_history";

    @Test
    void safetyValidationRunsBeforeBootstrap() {
        ProductionSafetyValidator validator = validator(safeJdbc(), false, FLYWAY_HISTORY_TABLE);
        BootstrapPlatformAdminRunner bootstrap = new BootstrapPlatformAdminRunner(
                validSecurity(), reference -> new char[0], null);

        assertThat(validator.getOrder()).isLessThan(bootstrap.getOrder());
    }

    @Test
    void acceptsSafeRuntimeRoleAndCompatibleSchema() {
        assertThatCode(() -> validator(safeJdbc(), false, FLYWAY_HISTORY_TABLE).run(null))
                .doesNotThrowAnyException();
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void checksOtaHotelThroughCatalogWithoutRequiringOtaSchemaUsage() throws Exception {
        JdbcTemplate jdbc = safeJdbc();

        validator(jdbc, false, FLYWAY_HISTORY_TABLE).run(null);

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc).queryForObject(
                sql.capture(), any(RowMapper.class), eq(FLYWAY_HISTORY_TABLE));
        assertThat(sql.getValue())
                .contains("required_namespace.nspname = 'ota'")
                .contains("required_class.relname = 'hotel'")
                .doesNotContain("to_regclass('ota.hotel')");
    }

    @Test
    void rejectsFlywayInsideApiProcess() {
        assertThatThrownBy(() -> validator(safeJdbc(), true, FLYWAY_HISTORY_TABLE).run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("separate migration job");
    }

    @Test
    void rejectsUnsafeRuntimeDatabaseRoles() {
        for (ProductionSafetyValidator.DatabaseRoleSafety unsafe : new ProductionSafetyValidator.DatabaseRoleSafety[]{
                role(true, false, false, true, true, true, true),
                role(false, true, false, true, true, true, true),
                role(false, false, true, true, true, true, true),
                role(false, false, false, false, true, true, true)}) {
            assertThatThrownBy(() -> validator(
                    jdbc(unsafe, successfulV1History()), false, FLYWAY_HISTORY_TABLE).run(null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("NOSUPERUSER");
        }
    }

    @Test
    void rejectsEmptyOrIncompleteSchema() {
        ProductionSafetyValidator.DatabaseRoleSafety emptySchema =
                role(false, false, false, true, false, false, false);
        ProductionSafetyValidator.DatabaseRoleSafety missingRequiredObjects =
                role(false, false, false, true, false, true, true);
        ProductionSafetyValidator.DatabaseRoleSafety missingFlywayHistory =
                role(false, false, false, true, true, false, true);

        for (ProductionSafetyValidator.DatabaseRoleSafety unsafeSchema : new ProductionSafetyValidator.DatabaseRoleSafety[]{
                emptySchema, missingRequiredObjects, missingFlywayHistory}) {
            assertThatThrownBy(() -> validator(
                    jdbc(unsafeSchema, successfulV1History()), false, FLYWAY_HISTORY_TABLE).run(null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("schema is absent or incomplete");
        }
    }

    @Test
    void rejectsFailedMigrationOrSchemaBelowV2() {
        for (ProductionSafetyValidator.MigrationHistoryState incompatible :
                new ProductionSafetyValidator.MigrationHistoryState[]{
                        new ProductionSafetyValidator.MigrationHistoryState(1, true),
                        new ProductionSafetyValidator.MigrationHistoryState(0, false)}) {
            assertThatThrownBy(() -> validator(
                    jdbc(safeRole(), incompatible), false, FLYWAY_HISTORY_TABLE).run(null))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("below required V2");
        }
    }

    @Test
    void rejectsUnsafeFlywayHistoryIdentifier() {
        assertThatThrownBy(() -> validator(
                safeJdbc(), false, "flyway.flyway_schema_history;drop table control.auth_account").run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("safe schema-qualified identifier");
    }

    private static ProductionSafetyValidator validator(
            JdbcTemplate jdbc,
            boolean flywayEnabled,
            String flywayHistoryTable
    ) {
        return new ProductionSafetyValidator(
                validDataSource(), validSecurity(), jdbc, flywayEnabled, flywayHistoryTable);
    }

    private static JdbcTemplate safeJdbc() {
        return jdbc(safeRole(), successfulV1History());
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static JdbcTemplate jdbc(
            ProductionSafetyValidator.DatabaseRoleSafety role,
            ProductionSafetyValidator.MigrationHistoryState history
    ) {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject(anyString(), any(RowMapper.class), anyString())).thenReturn(role);
        when(jdbc.queryForObject(anyString(), any(RowMapper.class))).thenReturn(history);
        return jdbc;
    }

    private static ProductionSafetyValidator.DatabaseRoleSafety safeRole() {
        return role(false, false, false, true, true, true, true);
    }

    private static ProductionSafetyValidator.DatabaseRoleSafety role(
            boolean superuser,
            boolean bypassRls,
            boolean ownsOtaTable,
            boolean rowSecurityOn,
            boolean requiredObjectsPresent,
            boolean flywayHistoryPresent,
            boolean sprintOneObjectsPresent
    ) {
        return new ProductionSafetyValidator.DatabaseRoleSafety(
                superuser,
                bypassRls,
                ownsOtaTable,
                rowSecurityOn,
                requiredObjectsPresent,
                flywayHistoryPresent,
                sprintOneObjectsPresent);
    }

    private static ProductionSafetyValidator.MigrationHistoryState successfulV1History() {
        return new ProductionSafetyValidator.MigrationHistoryState(0, true);
    }

    private static DataSourceProperties validDataSource() {
        DataSourceProperties properties = new DataSourceProperties();
        properties.setUrl("jdbc:postgresql://db.example.test/ota");
        properties.setUsername("ota_api_app");
        return properties;
    }

    private static OtaSecurityProperties validSecurity() {
        OtaSecurityProperties properties = new OtaSecurityProperties();
        properties.setCurrentSigningSecretRef("env:OTA_ACCESS_SIGNING_KEY");
        return properties;
    }
}
