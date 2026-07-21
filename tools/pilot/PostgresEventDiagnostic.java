import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

public final class PostgresEventDiagnostic {
    private PostgresEventDiagnostic() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: PostgresEventDiagnostic <jdbc-url>");
        String owner = required("PILOT_DB_OWNER");
        String password = required("PILOT_DB_OWNER_PASSWORD");
        try (Connection connection = DriverManager.getConnection(args[0], owner, password)) {
            print(connection, "OUTBOX", """
                    select id::text, event_type, aggregate_type, status,
                           coalesce(last_error, ''), coalesce(dead_lettered_at::text, '')
                    from outbox_event
                    where status in ('FAILED', 'DEAD_LETTER')
                    order by occurred_at, id
                    """);
            print(connection, "MANAGEMENT_EVENT", """
                    select event.id::text, event.event_type, event.processing_status, event.attempt_count::text,
                           coalesce(event.last_error, ''), event.occurred_at::text,
                           coalesce(event.position_assignment_id::text, ''),
                           coalesce(employee.employee_no, ''), coalesce(employee.name, ''),
                           coalesce(position.code, ''), coalesce(organization.code, '')
                    from management_event event
                    left join employee_position_assignment assignment
                      on assignment.tenant_id = event.tenant_id and assignment.id = event.position_assignment_id
                    left join employee on employee.tenant_id = assignment.tenant_id and employee.id = assignment.employee_id
                    left join position_definition position
                      on position.tenant_id = assignment.tenant_id and position.id = assignment.position_id
                    left join org_unit organization
                      on organization.tenant_id = assignment.tenant_id and organization.id = assignment.org_unit_id
                    where event.processing_status in ('FAILED', 'DEAD_LETTER')
                    order by event.occurred_at, event.id
                    """);
            print(connection, "RULE_ACTION", """
                    select id::text, action_type, action_key, status, attempt_count::text,
                           coalesce(last_error, '')
                    from rule_action_execution
                    where status = 'FAILED'
                    order by created_at, id
                    """);
            print(connection, "DEAD_LETTER_ASSIGNMENT_MANAGER", """
                    select assignment.id::text, coalesce(assignment.manager_assignment_id::text, ''),
                           assignment.status, coalesce(manager.status, ''),
                           coalesce(manager_position.code, ''), coalesce(manager_org.code, '')
                    from employee_position_assignment assignment
                    left join employee_position_assignment manager
                      on manager.tenant_id = assignment.tenant_id and manager.id = assignment.manager_assignment_id
                    left join position_definition manager_position
                      on manager_position.tenant_id = manager.tenant_id and manager_position.id = manager.position_id
                    left join org_unit manager_org
                      on manager_org.tenant_id = manager.tenant_id and manager_org.id = manager.org_unit_id
                    where assignment.id in (
                      select position_assignment_id from management_event where processing_status = 'DEAD_LETTER'
                    )
                    order by assignment.id
                    """);
        }
    }

    private static void print(Connection connection, String section, String sql) throws Exception {
        int rows = 0;
        System.out.println("SECTION=" + section);
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            int columns = result.getMetaData().getColumnCount();
            while (result.next()) {
                rows++;
                StringBuilder line = new StringBuilder();
                for (int index = 1; index <= columns; index++) {
                    if (index > 1) line.append("\t");
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
