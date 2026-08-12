import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/** Read-only verification for the protected local Pilot platform administrator. */
public final class PilotPermanentAdminAudit {
    private PilotPermanentAdminAudit() { }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: <jdbc-url>");
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setReadOnly(true);
            print(connection, """
                    select 'flyway=' || max(version::int)
                    from flyway_schema_history where success and version ~ '^[0-9]+$'
                    """);
            print(connection, """
                    select 'account=' || login_name || ',status=' || status
                           || ',password_set=' || (password_hash is not null)::text
                           || ',failed=' || failed_login_attempts
                           || ',locked=' || (locked_until is not null and locked_until > now())::text
                    from user_account
                    where tenant_id='10000000-0000-0000-0000-000000000001'
                      and lower(login_name)='sfglzy'
                    """);
            print(connection, """
                    select 'role=' || role.code || ',scope=' || assignment.scope_type
                           || ',expires=' || coalesce(assignment.valid_to::text,'NEVER')
                           || ',permissions=' || count(distinct permission.id)::text
                    from role_assignment assignment
                    join app_role role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
                    left join role_permission grant_row on grant_row.tenant_id=role.tenant_id and grant_row.role_id=role.id
                    left join permission on permission.id=grant_row.permission_id
                    join user_account account on account.tenant_id=assignment.tenant_id and account.id=assignment.account_id
                    where assignment.tenant_id='10000000-0000-0000-0000-000000000001'
                      and lower(account.login_name)='sfglzy'
                      and role.code='PLATFORM_ADMIN' and assignment.valid_to is null
                    group by role.code,assignment.scope_type,assignment.valid_to
                    """);
            print(connection, """
                    select 'protection_triggers=' || count(*)::text
                    from pg_trigger where not tgisinternal
                      and tgname in ('trg_protect_pilot_platform_admin_account','trg_protect_pilot_platform_admin_grant')
                    """);
            print(connection, """
                    select 'bootstrap_audit=' || count(*)::text from audit_log
                    where tenant_id='10000000-0000-0000-0000-000000000001'
                      and action='PILOT_PERMANENT_ADMIN_CONFIGURED'
                    """);
        }
    }

    private static void print(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet row = statement.executeQuery(sql)) {
            if (!row.next()) throw new IllegalStateException("Expected audit row is missing");
            System.out.println(row.getString(1));
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
        return value;
    }
}
