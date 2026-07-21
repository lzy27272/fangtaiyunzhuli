import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public final class RepairPilotReportingChain {
    private static final UUID TENANT = UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID ACTOR = UUID.fromString("19000000-0000-0000-0000-000000000001");
    private static final List<Link> LINKS = List.of(
            new Link(UUID.fromString("19200000-0000-0000-0000-000000000005"),
                    UUID.fromString("19200000-0000-0000-0000-000000000004")),
            new Link(UUID.fromString("19200000-0000-0000-0000-000000000001"),
                    UUID.fromString("19200000-0000-0000-0000-000000000007"))
    );
    private static final List<UUID> EVENTS = List.of(
            UUID.fromString("afcd131f-8f28-4131-b595-c26fce9ac381"),
            UUID.fromString("d390e763-9697-42dc-be27-5b1357cbbea3")
    );

    private RepairPilotReportingChain() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: RepairPilotReportingChain <jdbc-url>");
        try (Connection connection = DriverManager.getConnection(args[0], required("PILOT_DB_OWNER"),
                required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setAutoCommit(false);
            try {
                UUID correlation = UUID.randomUUID();
                int linkUpdates = 0;
                for (Link link : LINKS) {
                    assertActiveAssignment(connection, link.manager());
                    try (PreparedStatement statement = connection.prepareStatement("""
                            update employee_position_assignment
                            set manager_assignment_id = ?
                            where tenant_id = ? and id = ? and status = 'ACTIVE'
                              and manager_assignment_id is null
                            """)) {
                        statement.setObject(1, link.manager());
                        statement.setObject(2, TENANT);
                        statement.setObject(3, link.child());
                        int changed = statement.executeUpdate();
                        if (changed != 1) throw new IllegalStateException("Guarded reporting-link update failed for " + link.child());
                        linkUpdates += changed;
                    }
                    writeAudit(connection, correlation, "PILOT_REPORTING_CHAIN_REPAIRED",
                            "POSITION_ASSIGNMENT", link.child(),
                            "{\"managerAssignmentId\":null}",
                            "{\"managerAssignmentId\":\"" + link.manager() + "\"}");
                }

                int eventUpdates = 0;
                for (UUID event : EVENTS) {
                    try (PreparedStatement statement = connection.prepareStatement("""
                            update management_event
                            set processing_status = 'FAILED', attempt_count = 0,
                                locked_by = null, locked_until = now(),
                                last_error = 'operator requeued after reporting chain repair',
                                row_version = row_version + 1
                            where tenant_id = ? and id = ? and processing_status = 'DEAD_LETTER'
                              and last_error = 'one or more rule actions failed'
                            """)) {
                        statement.setObject(1, TENANT);
                        statement.setObject(2, event);
                        int changed = statement.executeUpdate();
                        if (changed != 1) throw new IllegalStateException("Guarded event requeue failed for " + event);
                        eventUpdates += changed;
                    }
                    writeAudit(connection, correlation, "MANAGEMENT_EVENT_REQUEUED",
                            "MANAGEMENT_EVENT", event,
                            "{\"processingStatus\":\"DEAD_LETTER\"}",
                            "{\"processingStatus\":\"FAILED\",\"reason\":\"reporting chain repaired\"}");
                }
                connection.commit();
                System.out.println("PILOT_REPORTING_CHAIN_REPAIR_OK links=" + linkUpdates
                        + " eventsRequeued=" + eventUpdates + " at=" + OffsetDateTime.now());
            } catch (Exception exception) {
                connection.rollback();
                throw exception;
            }
        }
    }

    private static void assertActiveAssignment(Connection connection, UUID assignmentId) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                select count(*) from employee_position_assignment
                where tenant_id = ? and id = ? and status = 'ACTIVE'
                  and valid_from <= current_date and (valid_to is null or valid_to >= current_date)
                """)) {
            statement.setObject(1, TENANT);
            statement.setObject(2, assignmentId);
            try (ResultSet result = statement.executeQuery()) {
                if (!result.next() || result.getInt(1) != 1) {
                    throw new IllegalStateException("Manager assignment is not uniquely active: " + assignmentId);
                }
            }
        }
    }

    private static void writeAudit(Connection connection, UUID correlation, String action, String type,
                                   UUID resourceId, String before, String after) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                insert into audit_log
                    (tenant_id, actor_id, action, resource_type, resource_id, correlation_id, before_data, after_data)
                values (?, ?, ?, ?, ?, ?, cast(? as jsonb), cast(? as jsonb))
                """)) {
            statement.setObject(1, TENANT);
            statement.setObject(2, ACTOR);
            statement.setString(3, action);
            statement.setString(4, type);
            statement.setObject(5, resourceId);
            statement.setObject(6, correlation);
            statement.setString(7, before);
            statement.setString(8, after);
            statement.executeUpdate();
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + name);
        return value;
    }

    private record Link(UUID child, UUID manager) {
    }
}
