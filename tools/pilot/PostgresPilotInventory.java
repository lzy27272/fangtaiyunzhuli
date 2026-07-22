import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/** Read-only inventory used before a scoped Pilot data cleanup. */
public final class PostgresPilotInventory {
    private PostgresPilotInventory() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: PostgresPilotInventory <jdbc-url>");
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setReadOnly(true);
            print(connection, "PILOT7_VERIFICATION", """
                    select
                      (select coalesce(max(version::integer), 0)::text from flyway_schema_history where success and version ~ '^[0-9]+$') as flyway_version,
                      (select count(*)::text from org_unit where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and (code like 'UAT-R-%' or code like 'UAT-H-%' or code like 'UAT-D-%' or code like 'UI-H-%'
                             or code in ('SOUTH-REGION-UAT', 'SZ-BAY-UAT', 'SZ-FRONT-UAT'))) as residual_test_orgs,
                      (select count(*)::text from position_definition where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and (code like 'UAT-P-%' or code like 'UI-P-%')) as residual_test_positions,
                      (select count(*)::text from user_account where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and (login_name like 'uat.front.%' or login_name like 'ui.%')) as residual_test_accounts,
                      (select count(*)::text from app_role where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and code in ('CEO', 'GENERAL_MANAGER', 'ASSISTANT_GENERAL_MANAGER', 'FRONT_OFFICE_SUPERVISOR',
                                     'HOUSEKEEPING_SUPERVISOR', 'FRONT_DESK', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER')) as protected_roles,
                      (select count(*)::text from position_definition where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and code in ('FRONT_DESK', 'HOUSEKEEPING_SUPERVISOR', 'FRONT_OFFICE_SUPERVISOR', 'GENERAL_MANAGER',
                                     'ASSISTANT_GENERAL_MANAGER', 'OTA_OPERATION_ASSISTANT', 'OTA_OPERATION_MANAGER')) as protected_positions,
                      (select count(*)::text from user_account where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and login_name in ('ceo.demo', 'sfgrff', 'sfglzy')) as protected_accounts,
                      (select count(*)::text from work_package_definition where tenant_id = '10000000-0000-0000-0000-000000000001'
                        and code = '123') as protected_work_package
                    """);
            print(connection, "ORGANIZATIONS", """
                    select id::text, code, name, unit_type, status, coalesce(parent_id::text, '')
                    from org_unit
                    where tenant_id = '10000000-0000-0000-0000-000000000001'
                    order by unit_type, parent_id nulls first, code
                    """);
            print(connection, "ROLES", """
                    select role.id::text, role.code, role.name, role.role_type,
                           count(assignment.id)::text as active_assignments
                    from app_role role
                    left join role_assignment assignment
                      on assignment.tenant_id = role.tenant_id and assignment.role_id = role.id
                     and (assignment.valid_to is null or assignment.valid_to >= current_date)
                    where role.tenant_id = '10000000-0000-0000-0000-000000000001'
                    group by role.id, role.code, role.name, role.role_type
                    order by role.code
                    """);
            print(connection, "POSITIONS", """
                    select position.id::text, position.code, position.name,
                           coalesce(position.job_family, ''), coalesce(position.level_code, ''),
                           count(assignment.id) filter (where assignment.status = 'ACTIVE')::text
                    from position_definition position
                    left join employee_position_assignment assignment
                      on assignment.tenant_id = position.tenant_id and assignment.position_id = position.id
                    where position.tenant_id = '10000000-0000-0000-0000-000000000001'
                    group by position.id, position.code, position.name, position.job_family, position.level_code
                    order by position.code
                    """);
            print(connection, "TASKS", """
                    select task.lifecycle_status, task.sla_status, count(*)::text
                    from management_task task
                    where task.tenant_id = '10000000-0000-0000-0000-000000000001'
                    group by task.lifecycle_status, task.sla_status
                    order by task.lifecycle_status, task.sla_status
                    """);
            print(connection, "TASK_RECIPIENTS", """
                    select task.task_no, task.lifecycle_status, task.title,
                           assignee.employee_snapshot ->> 'name', assignee.position_snapshot ->> 'name',
                           reviewer.employee_snapshot ->> 'name', reviewer.position_snapshot ->> 'name'
                    from management_task task
                    left join task_participant assignee
                      on assignee.tenant_id = task.tenant_id and assignee.task_id = task.id
                     and assignee.participant_type = 'ASSIGNEE' and assignee.valid_to is null
                    left join task_participant reviewer
                      on reviewer.tenant_id = task.tenant_id and reviewer.task_id = task.id
                     and reviewer.participant_type = 'REVIEWER' and reviewer.valid_to is null
                    where task.tenant_id = '10000000-0000-0000-0000-000000000001'
                    order by task.created_at desc
                    limit 30
                    """);
            print(connection, "NOTIFICATIONS", """
                    select notification_type, count(*)::text
                    from notification
                    where tenant_id = '10000000-0000-0000-0000-000000000001'
                    group by notification_type order by notification_type
                    """);
            print(connection, "EVALUATIONS", """
                    select outcome, execution_status, count(*)::text
                    from standard_evaluation
                    where tenant_id = '10000000-0000-0000-0000-000000000001'
                    group by outcome, execution_status order by outcome, execution_status
                    """);
            print(connection, "WORK_PACKAGE_STANDARD_LINKS", """
                    select package.code, package.name, package.status,
                           standard.code, standard.name, standard_version.lifecycle_status,
                           link.usage_type
                    from work_package_item_standard link
                    join work_package_item item
                      on item.tenant_id = link.tenant_id and item.id = link.work_package_item_id
                    join work_package_version package_version
                      on package_version.tenant_id = item.tenant_id
                     and package_version.id = item.work_package_version_id
                    join work_package_definition package
                      on package.tenant_id = package_version.tenant_id
                     and package.id = package_version.work_package_definition_id
                    join standard_version
                      on standard_version.tenant_id = link.tenant_id
                     and standard_version.id = link.standard_version_id
                    join standard_definition standard
                      on standard.tenant_id = standard_version.tenant_id
                     and standard.id = standard_version.standard_id
                    where link.tenant_id = '10000000-0000-0000-0000-000000000001'
                    order by package.code, standard.code, package_version.version_no
                    """);
            print(connection, "CORE_FOREIGN_KEYS", """
                    select conrelid::regclass::text, conname, confrelid::regclass::text,
                           pg_get_constraintdef(oid)
                    from pg_constraint
                    where contype = 'f'
                      and confrelid::regclass::text in (
                        'org_unit', 'position_definition', 'user_account', 'employee',
                        'employee_position_assignment', 'work_package_definition',
                        'work_package_version', 'work_package_item', 'work_package_allocation',
                        'work_expectation', 'work_record', 'management_event',
                        'rule_definition', 'rule_version', 'management_task'
                        , 'standard_definition', 'standard_version',
                        'form_definition', 'form_version', 'standard_evaluation',
                        'standard_evaluation_item', 'attachment', 'app_role'
                      )
                    order by confrelid::regclass::text, conrelid::regclass::text, conname
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
                    if (value != null) line.append(value.replace('\t', ' ').replace('\r', ' ').replace('\n', ' '));
                }
                System.out.println(line);
            }
        }
        System.out.println("ROWS=" + rows);
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + name);
        return value;
    }
}
