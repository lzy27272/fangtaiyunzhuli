import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/** Read-only Pilot audit for account, role, position and permission readiness. */
public final class PostgresRoleAccessAudit {
    private PostgresRoleAccessAudit() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("Usage: PostgresRoleAccessAudit <jdbc-url>");
        }
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setReadOnly(true);
            print(connection, "DATABASE", """
                    select current_date::text,
                           now()::text,
                           coalesce((select max(version::integer)::text
                                     from flyway_schema_history
                                     where success and version ~ '^[0-9]+$'), '0')
                    """);
            print(connection, "ACCOUNT_ACCESS", """
                    select account.login_name,
                           account.status as account_status,
                           case when account.password_hash is null then 'NO_PASSWORD' else 'PASSWORD_SET' end,
                           coalesce(employee.employment_status, 'NO_EMPLOYEE') as employment_status,
                           coalesce(position.code, 'NO_POSITION') as position_code,
                           coalesce(organization.code, 'NO_ORG') as organization_code,
                           coalesce(assignment.status, 'NO_ASSIGNMENT') as assignment_status,
                           coalesce(assignment.valid_from::text, '') as assignment_from,
                           coalesce(assignment.valid_to::text, '') as assignment_to,
                           coalesce(assignment.is_primary::text, '') as is_primary,
                           coalesce(role.code, 'NO_ROLE') as role_code,
                           coalesce(role_assignment.scope_type, 'NO_SCOPE') as scope_type,
                           coalesce(role_assignment.valid_from::text, '') as role_from,
                           coalesce(role_assignment.valid_to::text, '') as role_to,
                           (select count(distinct permission.code)::text
                              from role_permission
                              join permission on permission.id = role_permission.permission_id
                             where role_permission.tenant_id = account.tenant_id
                               and role_permission.role_id = role.id) as role_permission_count
                    from user_account account
                    left join employee
                      on employee.tenant_id = account.tenant_id
                     and employee.account_id = account.id
                    left join employee_position_assignment assignment
                      on assignment.tenant_id = employee.tenant_id
                     and assignment.employee_id = employee.id
                    left join position_definition position
                      on position.tenant_id = assignment.tenant_id
                     and position.id = assignment.position_id
                    left join org_unit organization
                      on organization.tenant_id = assignment.tenant_id
                     and organization.id = assignment.org_unit_id
                    left join role_assignment
                      on role_assignment.tenant_id = account.tenant_id
                     and role_assignment.account_id = account.id
                    left join app_role role
                      on role.tenant_id = role_assignment.tenant_id
                     and role.id = role_assignment.role_id
                    where account.tenant_id = '10000000-0000-0000-0000-000000000001'
                    order by account.login_name,
                             assignment.is_primary desc nulls last,
                             position.code,
                             role.code
                    """);
            print(connection, "ORGANIZATION_STATE", """
                    select organization.code,
                           organization.unit_type,
                           organization.status,
                           coalesce(parent.code, '') as parent_code,
                           organization.updated_at::text
                    from org_unit organization
                    left join org_unit parent
                      on parent.tenant_id = organization.tenant_id
                     and parent.id = organization.parent_id
                    where organization.tenant_id = '10000000-0000-0000-0000-000000000001'
                    order by organization.unit_type, organization.code
                    """);
            print(connection, "RECENT_ORGANIZATION_AUDIT", """
                    select audit.created_at::text,
                           audit.action,
                           audit.resource_type,
                           coalesce(organization.code, audit.resource_id::text, ''),
                           coalesce(account.login_name, audit.actor_id::text, ''),
                           coalesce(audit.after_data::text, '')
                    from audit_log audit
                    left join org_unit organization
                      on organization.tenant_id = audit.tenant_id
                     and organization.id = audit.resource_id
                    left join user_account account
                      on account.tenant_id = audit.tenant_id
                     and account.id = audit.actor_id
                    where audit.tenant_id = '10000000-0000-0000-0000-000000000001'
                      and audit.created_at >= now() - interval '7 days'
                      and audit.resource_type in ('ORG_UNIT', 'POSITION', 'EMPLOYEE', 'MAINTENANCE')
                    order by audit.created_at desc
                    limit 100
                    """);
        }
    }

    private static void print(Connection connection, String section, String sql) throws Exception {
        System.out.println("SECTION=" + section);
        int rows = 0;
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            int columns = result.getMetaData().getColumnCount();
            while (result.next()) {
                rows++;
                StringBuilder line = new StringBuilder();
                for (int index = 1; index <= columns; index++) {
                    if (index > 1) line.append('\t');
                    String value = result.getString(index);
                    if (value != null) {
                        line.append(value.replace('\t', ' ').replace('\r', ' ').replace('\n', ' '));
                    }
                }
                System.out.println(line);
            }
        }
        System.out.println("ROWS=" + rows);
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + name);
        }
        return value;
    }
}
