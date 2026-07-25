package cn.sifangguan.ota.api.tenancy;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.HexFormat;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class PostgresSecurityIntegrationTest {
    @Test
    void nonOwnerNonBypassAppRoleEnforcesTenantRlsAndAppendOnlyAudit() throws Exception {
        Assumptions.assumeTrue("isolated-database".equals(System.getenv("OTA_POSTGRES_IT_CONFIRM")),
                "Use only a disposable PostgreSQL database");
        String adminUrl = required("OTA_POSTGRES_IT_ADMIN_URL");
        String adminUsername = required("OTA_POSTGRES_IT_ADMIN_USERNAME");
        String adminPassword = required("OTA_POSTGRES_IT_ADMIN_PASSWORD");
        String migrationUrl = required("OTA_POSTGRES_IT_MIGRATION_URL");
        String migrationUsername = required("OTA_POSTGRES_IT_MIGRATION_USERNAME");
        String migrationPassword = required("OTA_POSTGRES_IT_MIGRATION_PASSWORD");
        Flyway.configure()
                .dataSource(migrationUrl, migrationUsername, migrationPassword)
                .locations("classpath:db/migration")
                .defaultSchema("flyway")
                .schemas("flyway")
                .validateMigrationNaming(true)
                .cleanDisabled(true)
                .load()
                .migrate();
        try (Connection admin = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword)) {
            assertMigrationOwnerIsSafeAndOwnsDeploymentObjects(
                    admin, migrationUsername);
        }

        UUID firstTenant = UUID.randomUUID();
        UUID secondTenant = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        String appRole = "ota_it_" + UUID.randomUUID().toString().replace("-", "");
        String appPassword = randomPassword();
        boolean roleCreated = false;
        try {
            try (Connection admin = DriverManager.getConnection(adminUrl, adminUsername, adminPassword)) {
                createRestrictedAppRole(admin, appRole, appPassword);
                roleCreated = true;
                assertRoleIsSafe(admin, appRole);
            }
            try (Connection migration = DriverManager.getConnection(
                    migrationUrl, migrationUsername, migrationPassword)) {
                seedHotelAsMigrationIdentity(
                        migration, firstTenant, secondTenant, hotelId);
            }

            try (Connection app = DriverManager.getConnection(migrationUrl, appRole, appPassword)) {
                assertCurrentRoleIsSafe(app);

                app.setAutoCommit(false);
                assertThat(countHotels(app)).isZero();
                app.rollback();

                app.setAutoCommit(false);
                setTenant(app, secondTenant);
                assertThat(countHotels(app)).isZero();
                app.rollback();

                app.setAutoCommit(false);
                setTenant(app, firstTenant);
                assertThat(countHotels(app)).isEqualTo(1);
                app.rollback();

                UUID auditId = UUID.randomUUID();
                app.setAutoCommit(false);
                try (PreparedStatement insert = app.prepareStatement("""
                        insert into control.audit_event
                            (audit_event_id, occurred_at, actor_type, action_code, resource_type, outcome_code)
                        values (?, current_timestamp, 'ANONYMOUS', 'test.rls', 'TEST', 'SUCCEEDED')
                        """)) {
                    insert.setObject(1, auditId);
                    insert.executeUpdate();
                }
                app.commit();

                app.setAutoCommit(false);
                assertThatThrownBy(() -> {
                    try (PreparedStatement update = app.prepareStatement(
                            "update control.audit_event set outcome_code = 'FAILED' where audit_event_id = ?")) {
                        update.setObject(1, auditId);
                        update.executeUpdate();
                    }
                }).isInstanceOf(SQLException.class)
                        .extracting(error -> ((SQLException) error).getSQLState())
                        .isEqualTo("55000");
                app.rollback();
            }
        } finally {
            if (roleCreated) {
                try (Connection admin = DriverManager.getConnection(adminUrl, adminUsername, adminPassword);
                     Statement statement = admin.createStatement()) {
                    statement.execute("drop owned by " + appRole);
                    statement.execute("drop role " + appRole);
                }
            }
        }
    }

    private static void seedHotelAsMigrationIdentity(
            Connection admin,
            UUID firstTenant,
            UUID secondTenant,
            UUID hotelId
    ) throws SQLException {
        admin.setAutoCommit(false);
        insertTenant(admin, firstTenant, "first-" + firstTenant);
        insertTenant(admin, secondTenant, "second-" + secondTenant);
        setTenant(admin, firstTenant);
        try (PreparedStatement insert = admin.prepareStatement("""
                insert into ota.hotel(tenant_id, hotel_id, hotel_code, display_name)
                values (?, ?, ?, 'RLS Test Hotel')
                """)) {
            insert.setObject(1, firstTenant);
            insert.setObject(2, hotelId);
            insert.setString(3, "hotel-" + hotelId);
            insert.executeUpdate();
        }
        admin.commit();
    }

    private static void createRestrictedAppRole(
            Connection admin,
            String role,
            String password
    ) throws SQLException {
        admin.setAutoCommit(true);
        try (Statement statement = admin.createStatement()) {
            // Both generated values contain only lowercase hex/alphanumeric characters and are never logged.
            statement.execute("create role " + role + " with login password '" + password
                    + "' nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
            statement.execute("grant usage on schema control, ota to " + role);
            statement.execute("grant execute on function control.current_tenant_id() to " + role);
            statement.execute("grant select on ota.hotel to " + role);
            statement.execute("grant select, insert, update on control.audit_event to " + role);
        }
    }

    private static void assertRoleIsSafe(Connection admin, String role) throws SQLException {
        try (PreparedStatement statement = admin.prepareStatement("""
                select r.rolsuper,
                       r.rolbypassrls,
                       exists (
                           select 1 from pg_catalog.pg_class c
                           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'ota' and c.relkind in ('r', 'p') and c.relowner = r.oid
                       ) as owns_ota_table
                  from pg_catalog.pg_roles r where r.rolname = ?
                """)) {
            statement.setString(1, role);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getBoolean("rolsuper")).isFalse();
                assertThat(result.getBoolean("rolbypassrls")).isFalse();
                assertThat(result.getBoolean("owns_ota_table")).isFalse();
            }
        }
    }

    private static void assertMigrationOwnerIsSafeAndOwnsDeploymentObjects(
            Connection admin,
            String migrationRole) throws SQLException {
        try (PreparedStatement statement = admin.prepareStatement("""
                select role.rolcanlogin,
                       not role.rolsuper as not_superuser,
                       not role.rolbypassrls as not_bypassrls,
                       not role.rolinherit as not_inherit,
                       exists (
                           select 1
                             from pg_catalog.pg_class relation
                             join pg_catalog.pg_namespace namespace
                               on namespace.oid = relation.relnamespace
                            where namespace.nspname = 'ota'
                              and relation.relkind in ('r', 'p')
                              and relation.relowner = role.oid
                       ) as owns_ota_table,
                       exists (
                           select 1
                             from pg_catalog.pg_class relation
                             join pg_catalog.pg_namespace namespace
                               on namespace.oid = relation.relnamespace
                            where namespace.nspname = 'control'
                              and relation.relkind in ('r', 'p')
                              and relation.relowner = role.oid
                       ) as owns_control_table,
                       (
                           select bool_and(
                                      function.proowner = role.oid
                                      and function.prosecdef
                                  )
                             from pg_catalog.pg_proc function
                            where function.oid in (
                                to_regprocedure(
                                    'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'
                                ),
                                to_regprocedure(
                                    'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)'
                                )
                            )
                       ) as owns_security_definer_functions
                  from pg_catalog.pg_roles role
                 where role.rolname = ?
                """)) {
            statement.setString(1, migrationRole);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getBoolean("rolcanlogin")).isTrue();
                assertThat(result.getBoolean("not_superuser")).isTrue();
                assertThat(result.getBoolean("not_bypassrls")).isTrue();
                assertThat(result.getBoolean("not_inherit")).isTrue();
                assertThat(result.getBoolean("owns_ota_table")).isTrue();
                assertThat(result.getBoolean("owns_control_table")).isTrue();
                assertThat(result.getBoolean("owns_security_definer_functions"))
                        .isTrue();
            }
        }
    }

    private static void assertCurrentRoleIsSafe(Connection app) throws SQLException {
        try (Statement statement = app.createStatement();
             ResultSet result = statement.executeQuery("""
                     select r.rolsuper,
                            r.rolbypassrls,
                            exists (
                                select 1 from pg_catalog.pg_class c
                                join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                                where n.nspname = 'ota' and c.relkind in ('r', 'p') and c.relowner = r.oid
                            ) as owns_ota_table,
                            current_setting('row_security') = 'on' as row_security_on
                       from pg_catalog.pg_roles r where r.rolname = current_user
                     """)) {
            assertThat(result.next()).isTrue();
            assertThat(result.getBoolean("rolsuper")).isFalse();
            assertThat(result.getBoolean("rolbypassrls")).isFalse();
            assertThat(result.getBoolean("owns_ota_table")).isFalse();
            assertThat(result.getBoolean("row_security_on")).isTrue();
        }
    }

    private static void insertTenant(Connection connection, UUID tenantId, String code) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement("""
                insert into control.tenant_directory(tenant_id, tenant_code, display_name, status)
                values (?, ?, 'RLS Test Tenant', 'ACTIVE')
                """)) {
            insert.setObject(1, tenantId);
            insert.setString(2, code);
            insert.executeUpdate();
        }
    }

    private static void setTenant(Connection connection, UUID tenantId) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "select set_config('app.tenant_id', ?, true)")) {
            statement.setString(1, tenantId.toString());
            statement.executeQuery().close();
        }
    }

    private static int countHotels(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("select count(*) from ota.hotel")) {
            result.next();
            return result.getInt(1);
        }
    }

    private static String randomPassword() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        try {
            return HexFormat.of().formatHex(bytes);
        } finally {
            java.util.Arrays.fill(bytes, (byte) 0);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required for the explicit PostgreSQL integration test");
        }
        return value;
    }
}
