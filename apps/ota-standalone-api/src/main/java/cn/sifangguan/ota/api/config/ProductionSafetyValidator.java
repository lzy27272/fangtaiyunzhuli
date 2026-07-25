package cn.sifangguan.ota.api.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Locale;
import java.util.regex.Pattern;

public final class ProductionSafetyValidator implements ApplicationRunner, Ordered {
    private final DataSourceProperties dataSource;
    private final OtaSecurityProperties security;
    private final JdbcTemplate jdbc;
    private final boolean flywayEnabledInApi;
    private final String flywayHistoryTable;
    private static final Pattern QUALIFIED_TABLE = Pattern.compile(
            "[a-z][a-z0-9_]{0,62}\\.[a-z][a-z0-9_]{0,62}");

    public ProductionSafetyValidator(
            DataSourceProperties dataSource,
            OtaSecurityProperties security,
            JdbcTemplate jdbc,
            boolean flywayEnabledInApi,
            String flywayHistoryTable
    ) {
        this.dataSource = dataSource;
        this.security = security;
        this.jdbc = jdbc;
        this.flywayEnabledInApi = flywayEnabledInApi;
        this.flywayHistoryTable = flywayHistoryTable;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }

    @Override
    public void run(ApplicationArguments args) {
        String url = dataSource.getUrl();
        if (url == null || !url.startsWith("jdbc:postgresql://")) {
            throw new IllegalStateException("OTA standalone API requires an explicit PostgreSQL URL");
        }
        String lowerUrl = url.toLowerCase(Locale.ROOT);
        if (lowerUrl.contains("password=") || lowerUrl.contains("user=")) {
            throw new IllegalStateException("Database credentials must not be embedded in the JDBC URL");
        }
        if (dataSource.getUsername() == null || dataSource.getUsername().isBlank()) {
            throw new IllegalStateException("A dedicated PostgreSQL runtime account is required");
        }
        if (flywayEnabledInApi) {
            throw new IllegalStateException("Flyway must run as a separate migration job, not in the API process");
        }
        if (flywayHistoryTable == null || !QUALIFIED_TABLE.matcher(flywayHistoryTable).matches()) {
            throw new IllegalStateException("Flyway history table must be a safe schema-qualified identifier");
        }
        if (!security.getCurrentSigningSecretRef().startsWith("env:")) {
            throw new IllegalStateException("Access signing material must be configured by secret reference");
        }
        if (!security.getCookie().isSecure() || !"Strict".equals(security.getCookie().getSameSite())) {
            throw new IllegalStateException("Refresh and CSRF cookies must be Secure and SameSite=Strict");
        }
        if (!"/api/v1/auth".equals(security.getCookie().getRefreshPath())
                || !"/".equals(security.getCookie().getCsrfPath())) {
            throw new IllegalStateException("Refresh and CSRF cookie paths must preserve the split-cookie boundary");
        }
        if (security.getCors().getAllowedOrigins().stream()
                .anyMatch(value -> "*".equals(value) || !value.startsWith("https://"))) {
            throw new IllegalStateException("CORS origins must be an explicit HTTPS allow-list");
        }
        if (security.getBootstrap().isEnabled()
                && !security.getBootstrap().getPasswordSecretRef().startsWith("env:")) {
            throw new IllegalStateException("Bootstrap password must be supplied by a one-time secret reference");
        }
        DatabaseRoleSafety role = jdbc.queryForObject("""
                        select r.rolsuper,
                               r.rolbypassrls,
                               exists (
                                   select 1
                                     from pg_catalog.pg_class c
                                     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                                    where n.nspname = 'ota'
                                      and c.relkind in ('r', 'p')
                                      and c.relowner = r.oid
                               ) as owns_ota_table,
                               current_setting('row_security') = 'on' as row_security_on,
                               to_regclass('control.auth_account') is not null
                                 and to_regclass('control.auth_session') is not null
                                 and to_regclass('control.audit_event') is not null
                                 and exists (
                                     select 1
                                       from pg_catalog.pg_class required_class
                                       join pg_catalog.pg_namespace required_namespace
                                         on required_namespace.oid = required_class.relnamespace
                                      where required_namespace.nspname = 'ota'
                                        and required_class.relname = 'hotel'
                                        and required_class.relkind in ('r', 'p')
                                 ) as required_objects_present,
                               to_regclass(?) is not null as flyway_history_present,
                               exists (
                                   select 1
                                     from pg_catalog.pg_class sprint1_class
                                     join pg_catalog.pg_namespace sprint1_namespace
                                       on sprint1_namespace.oid = sprint1_class.relnamespace
                                    where sprint1_namespace.nspname = 'ota'
                                      and sprint1_class.relname = 'simulation_run'
                                      and sprint1_class.relkind in ('r', 'p')
                               )
                               and exists (
                                   select 1
                                     from pg_catalog.pg_class adapter_class
                                     join pg_catalog.pg_namespace adapter_namespace
                                       on adapter_namespace.oid = adapter_class.relnamespace
                                    where adapter_namespace.nspname = 'control'
                                      and adapter_class.relname = 'connector_adapter_registry'
                                      and adapter_class.relkind in ('r', 'p')
                               ) as sprint_one_objects_present
                          from pg_catalog.pg_roles r
                         where r.rolname = current_user
                        """,
                (resultSet, rowNumber) -> new DatabaseRoleSafety(
                        resultSet.getBoolean("rolsuper"),
                        resultSet.getBoolean("rolbypassrls"),
                        resultSet.getBoolean("owns_ota_table"),
                        resultSet.getBoolean("row_security_on"),
                        resultSet.getBoolean("required_objects_present"),
                        resultSet.getBoolean("flyway_history_present"),
                        resultSet.getBoolean("sprint_one_objects_present")),
                flywayHistoryTable);
        if (role == null || role.superuser() || role.bypassRls()
                || role.ownsOtaTable() || !role.rowSecurityOn()) {
            throw new IllegalStateException(
                    "OTA API database role must be NOSUPERUSER, NOBYPASSRLS, non-owner and row_security=on");
        }
        if (!role.requiredObjectsPresent() || !role.flywayHistoryPresent()
                || !role.sprintOneObjectsPresent()) {
            throw new IllegalStateException("OTA database schema is absent or incomplete; run the migration job first");
        }
        MigrationHistoryState history = jdbc.queryForObject("""
                        select count(*) filter (where not success) as failed_migrations,
                               coalesce(bool_or(success and version = '2'), false) as version_two_succeeded
                          from %s
                        """.formatted(flywayHistoryTable),
                (resultSet, rowNumber) -> new MigrationHistoryState(
                        resultSet.getLong("failed_migrations"),
                        resultSet.getBoolean("version_two_succeeded")));
        if (history == null || history.failedMigrations() != 0 || !history.versionTwoSucceeded()) {
            throw new IllegalStateException("OTA database migration history is failed, dirty, or below required V2");
        }
    }

    record DatabaseRoleSafety(
            boolean superuser,
            boolean bypassRls,
            boolean ownsOtaTable,
            boolean rowSecurityOn,
            boolean requiredObjectsPresent,
            boolean flywayHistoryPresent,
            boolean sprintOneObjectsPresent
    ) {
    }

    record MigrationHistoryState(
            long failedMigrations,
            boolean versionTwoSucceeded
    ) {
    }
}
