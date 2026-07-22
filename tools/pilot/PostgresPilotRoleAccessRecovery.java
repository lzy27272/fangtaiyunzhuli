import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;

/**
 * One-shot recovery for the fixed Pilot demo organization, position
 * assignments and role grants disabled by the audited 2026-07-22 EAST-REGION
 * incident. Any later lifecycle change fails closed instead of being revived.
 */
public final class PostgresPilotRoleAccessRecovery {
    private static final String TENANT_ID = "10000000-0000-0000-0000-000000000001";
    private static final String CONFIRMATION = "RESTORE-PILOT-DEMO-ACCESS";

    private PostgresPilotRoleAccessRecovery() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2 || args.length > 3) {
            throw new IllegalArgumentException(
                    "Usage: PostgresPilotRoleAccessRecovery <jdbc-url> <dry-run|execute> [confirmation]");
        }
        boolean execute = switch (args[1]) {
            case "dry-run" -> false;
            case "execute" -> true;
            default -> throw new IllegalArgumentException("Mode must be dry-run or execute");
        };
        String confirmation = args.length == 3 ? args[2] : "";
        if (execute && !CONFIRMATION.equals(confirmation)) {
            throw new IllegalArgumentException("Execute mode requires the exact confirmation");
        }

        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setAutoCommit(false);
            connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
            try {
                setTenantContext(connection);
                verifyTargets(connection);
                verifyIncidentPreconditions(connection);

                int organizations = update(connection, """
                        update org_unit
                           set status = 'ACTIVE', updated_at = now()
                         where tenant_id = ?::uuid
                           and id in ('12000000-0000-0000-0000-000000000002'::uuid,
                                      '12000000-0000-0000-0000-000000000003'::uuid,
                                      '12000000-0000-0000-0000-000000000004'::uuid,
                                      '12000000-0000-0000-0000-000000000005'::uuid,
                                      '12000000-0000-0000-0000-000000000006'::uuid)
                        """);
                int assignments = update(connection, """
                        update employee_position_assignment
                           set status = 'ACTIVE', valid_to = null, updated_at = now()
                         where tenant_id = ?::uuid
                           and id in ('19200000-0000-0000-0000-000000000001'::uuid,
                                      '19200000-0000-0000-0000-000000000002'::uuid,
                                      '19200000-0000-0000-0000-000000000003'::uuid,
                                      '19200000-0000-0000-0000-000000000004'::uuid,
                                      '19200000-0000-0000-0000-000000000005'::uuid,
                                      '19200000-0000-0000-0000-000000000006'::uuid,
                                      '19200000-0000-0000-0000-000000000007'::uuid,
                                      '19200000-0000-0000-0000-000000000008'::uuid)
                        """);
                int roles = update(connection, """
                        update role_assignment
                           set valid_to = null
                         where tenant_id = ?::uuid
                           and id in ('19500000-0000-0000-0000-000000000002'::uuid,
                                      '19500000-0000-0000-0000-000000000003'::uuid,
                                      '19500000-0000-0000-0000-000000000004'::uuid,
                                      '19500000-0000-0000-0000-000000000005'::uuid,
                                      '19500000-0000-0000-0000-000000000006'::uuid,
                                      '19500000-0000-0000-0000-000000000007'::uuid,
                                      '19500000-0000-0000-0000-000000000008'::uuid)
                        """);

                verifyRestoredState(connection);
                writeAudit(connection, organizations, assignments, roles, execute);

                System.out.printf("TARGET_UPDATES\torganizations=%d\tassignments=%d\troles=%d%n",
                        organizations, assignments, roles);
                if (execute) {
                    connection.commit();
                    System.out.println("PILOT_DEMO_ACCESS_RESTORED_AND_COMMITTED");
                } else {
                    connection.rollback();
                    System.out.println("PILOT_DEMO_ACCESS_DRY_RUN_VERIFIED_AND_ROLLED_BACK");
                }
            } catch (Exception failure) {
                connection.rollback();
                throw failure;
            }
        }
    }

    private static void setTenantContext(Connection connection) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
                "select set_config('app.tenant_id', ?, true)")) {
            statement.setString(1, TENANT_ID);
            statement.executeQuery().close();
        }
    }

    private static void verifyTargets(Connection connection) throws Exception {
        expect(connection, "ORGANIZATIONS", 5, """
                select count(*)
                  from org_unit
                 where tenant_id = ?::uuid
                   and (id, code) in (values
                       ('12000000-0000-0000-0000-000000000002'::uuid, 'EAST-REGION'),
                       ('12000000-0000-0000-0000-000000000003'::uuid, 'HZ-CENTER'),
                       ('12000000-0000-0000-0000-000000000004'::uuid, 'SH-RIVER'),
                       ('12000000-0000-0000-0000-000000000005'::uuid, 'HZ-FRONT'),
                       ('12000000-0000-0000-0000-000000000006'::uuid, 'HZ-HOUSEKEEPING'))
                """);
        expect(connection, "POSITION_ASSIGNMENTS", 8, """
                select count(*)
                  from employee_position_assignment assignment
                  join employee on employee.tenant_id = assignment.tenant_id
                               and employee.id = assignment.employee_id
                  join user_account account on account.tenant_id = employee.tenant_id
                                           and account.id = employee.account_id
                 where assignment.tenant_id = ?::uuid
                   and assignment.id in ('19200000-0000-0000-0000-000000000001'::uuid,
                                         '19200000-0000-0000-0000-000000000002'::uuid,
                                         '19200000-0000-0000-0000-000000000003'::uuid,
                                         '19200000-0000-0000-0000-000000000004'::uuid,
                                         '19200000-0000-0000-0000-000000000005'::uuid,
                                         '19200000-0000-0000-0000-000000000006'::uuid,
                                         '19200000-0000-0000-0000-000000000007'::uuid,
                                         '19200000-0000-0000-0000-000000000008'::uuid)
                   and account.login_name in ('gm.hz', 'front.demo', 'hk.supervisor', 'fo.supervisor',
                                              'ota.assistant', 'ota.manager', 'assistant.gm')
                """);
        expect(connection, "ROLE_ASSIGNMENTS", 7, """
                select count(*)
                  from role_assignment assignment
                  join user_account account on account.tenant_id = assignment.tenant_id
                                           and account.id = assignment.account_id
                 where assignment.tenant_id = ?::uuid
                   and assignment.id in ('19500000-0000-0000-0000-000000000002'::uuid,
                                         '19500000-0000-0000-0000-000000000003'::uuid,
                                         '19500000-0000-0000-0000-000000000004'::uuid,
                                         '19500000-0000-0000-0000-000000000005'::uuid,
                                         '19500000-0000-0000-0000-000000000006'::uuid,
                                         '19500000-0000-0000-0000-000000000007'::uuid,
                                         '19500000-0000-0000-0000-000000000008'::uuid)
                   and account.login_name in ('gm.hz', 'front.demo', 'hk.supervisor', 'fo.supervisor',
                                              'ota.assistant', 'ota.manager', 'assistant.gm')
                """);
    }

    private static void verifyIncidentPreconditions(Connection connection) throws Exception {
        expect(connection, "INCIDENT_INACTIVE_ORGANIZATIONS", 5, """
                select count(*) from org_unit
                 where tenant_id = ?::uuid and status = 'INACTIVE'
                   and id in ('12000000-0000-0000-0000-000000000002'::uuid,
                              '12000000-0000-0000-0000-000000000003'::uuid,
                              '12000000-0000-0000-0000-000000000004'::uuid,
                              '12000000-0000-0000-0000-000000000005'::uuid,
                              '12000000-0000-0000-0000-000000000006'::uuid)
                """);
        expect(connection, "INCIDENT_INACTIVE_POSITION_ASSIGNMENTS", 8, """
                select count(*) from employee_position_assignment
                 where tenant_id = ?::uuid and status = 'INACTIVE' and valid_to = date '2026-07-22'
                   and id in ('19200000-0000-0000-0000-000000000001'::uuid,
                              '19200000-0000-0000-0000-000000000002'::uuid,
                              '19200000-0000-0000-0000-000000000003'::uuid,
                              '19200000-0000-0000-0000-000000000004'::uuid,
                              '19200000-0000-0000-0000-000000000005'::uuid,
                              '19200000-0000-0000-0000-000000000006'::uuid,
                              '19200000-0000-0000-0000-000000000007'::uuid,
                              '19200000-0000-0000-0000-000000000008'::uuid)
                """);
        expect(connection, "INCIDENT_EXPIRED_ROLE_ASSIGNMENTS", 7, """
                select count(*) from role_assignment
                 where tenant_id = ?::uuid
                   and valid_to between timestamptz '2026-07-22 10:57:08+08'
                                    and timestamptz '2026-07-22 10:57:11+08'
                   and id in ('19500000-0000-0000-0000-000000000002'::uuid,
                              '19500000-0000-0000-0000-000000000003'::uuid,
                              '19500000-0000-0000-0000-000000000004'::uuid,
                              '19500000-0000-0000-0000-000000000005'::uuid,
                              '19500000-0000-0000-0000-000000000006'::uuid,
                              '19500000-0000-0000-0000-000000000007'::uuid,
                              '19500000-0000-0000-0000-000000000008'::uuid)
                """);
        expect(connection, "INCIDENT_AUDIT_EVENT", 1, """
                select count(*) from audit_log
                 where tenant_id = ?::uuid
                   and actor_id = '19000000-0000-0000-0000-000000000001'::uuid
                   and action = 'ORG_UNIT_UPDATED'
                   and resource_type = 'ORG_UNIT'
                   and resource_id = '12000000-0000-0000-0000-000000000002'::uuid
                   and after_data ->> 'status' = 'INACTIVE'
                   and created_at between timestamptz '2026-07-22 10:57:08+08'
                                      and timestamptz '2026-07-22 10:57:11+08'
                """);
    }

    private static void verifyRestoredState(Connection connection) throws Exception {
        expect(connection, "ACTIVE_ORGANIZATIONS", 5, """
                select count(*) from org_unit
                 where tenant_id = ?::uuid and status = 'ACTIVE'
                   and id between '12000000-0000-0000-0000-000000000002'::uuid
                              and '12000000-0000-0000-0000-000000000006'::uuid
                """);
        expect(connection, "ACTIVE_POSITION_ASSIGNMENTS", 8, """
                select count(*) from employee_position_assignment
                 where tenant_id = ?::uuid and status = 'ACTIVE' and valid_to is null
                   and id between '19200000-0000-0000-0000-000000000001'::uuid
                              and '19200000-0000-0000-0000-000000000008'::uuid
                """);
        expect(connection, "ACTIVE_ROLE_ASSIGNMENTS", 7, """
                select count(*) from role_assignment
                 where tenant_id = ?::uuid and valid_to is null
                   and id between '19500000-0000-0000-0000-000000000002'::uuid
                              and '19500000-0000-0000-0000-000000000008'::uuid
                """);
    }

    private static int update(Connection connection, String sql) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, TENANT_ID);
            return statement.executeUpdate();
        }
    }

    private static void expect(Connection connection, String label, int expected, String sql) throws Exception {
        int actual;
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            statement.setString(1, TENANT_ID);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next()) throw new IllegalStateException(label + " query returned no row");
                actual = result.getInt(1);
            }
        }
        System.out.printf("VERIFY\t%s\texpected=%d\tactual=%d%n", label, expected, actual);
        if (actual != expected) {
            throw new IllegalStateException(label + " target mismatch; refusing to continue");
        }
    }

    private static void writeAudit(
            Connection connection, int organizations, int assignments, int roles, boolean execute) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into audit_log
                    (tenant_id, actor_id, action, resource_type, resource_id, correlation_id,
                     before_data, after_data)
                values (?::uuid, '19000000-0000-0000-0000-000000000001'::uuid,
                        'PILOT_DEMO_ACCESS_RESTORED', 'MAINTENANCE',
                        '12000000-0000-0000-0000-000000000002'::uuid, gen_random_uuid(),
                        jsonb_build_object('source', 'EAST-REGION deactivation cascade'),
                        jsonb_build_object('mode', ?, 'organizations', ?, 'positionAssignments', ?,
                                           'roleAssignments', ?))
                """)) {
            statement.setString(1, TENANT_ID);
            statement.setString(2, execute ? "EXECUTE" : "DRY_RUN");
            statement.setInt(3, organizations);
            statement.setInt(4, assignments);
            statement.setInt(5, roles);
            statement.executeUpdate();
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + name);
        }
        return value;
    }
}
