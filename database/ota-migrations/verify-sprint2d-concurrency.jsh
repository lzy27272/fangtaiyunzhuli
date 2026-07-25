import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

String requiredEnvironment(String name) {
    String value = System.getenv(name);
    if (value == null || value.isBlank()) {
        throw new IllegalStateException("Missing environment variable: " + name);
    }
    return value;
}

Connection connection(String url, String username, String password)
        throws SQLException {
    return DriverManager.getConnection(url, username, password);
}

void bindActor(Connection connection) throws SQLException {
    try (Statement statement = connection.createStatement()) {
        statement.execute("""
                select set_config(
                    'app.tenant_id',
                    '92000000-0000-4000-8000-000000000001',
                    true
                )
                """);
        statement.execute("""
                select set_config(
                    'app.account_id',
                    '92000000-0000-4000-8000-000000000003',
                    true
                )
                """);
        statement.execute("""
                select set_config(
                    'app.auth_session_id',
                    '92000000-0000-4000-8000-000000000020',
                    true
                )
                """);
    }
}

UUID startReauthentication(
        Connection connection,
        UUID attemptId,
        UUID commandId,
        String idempotencyKey,
        String interactionHash,
        String requestHash
) throws SQLException {
    String sql = """
            select (
                ota.start_browser_authorization_rehearsal(
                    ?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid,
                    ?::uuid, ?::bigint, ?::text, ?::text, ?::text,
                    ?::timestamptz, ?::uuid, ?::text, ?::text,
                    ?::text, ?::uuid, ?::bigint
                )
            ).authorization_attempt_id
            """;
    try (PreparedStatement statement = connection.prepareStatement(sql)) {
        statement.setObject(
                1,
                UUID.fromString("92000000-0000-4000-8000-000000000001"));
        statement.setObject(
                2,
                UUID.fromString("92000000-0000-4000-8000-000000000002"));
        statement.setObject(
                3,
                UUID.fromString("92000000-0000-4000-8000-000000000005"));
        statement.setObject(
                4,
                UUID.fromString("92000000-0000-4000-8000-000000000006"));
        statement.setObject(5, attemptId);
        statement.setObject(
                6,
                UUID.fromString("92000000-0000-4000-8000-000000000003"));
        statement.setLong(7, 0L);
        statement.setString(8, "PMS_INTAKE");
        statement.setString(9, "0.0.0-concurrency");
        statement.setString(10, interactionHash);
        statement.setTimestamp(
                11,
                Timestamp.from(Instant.now().plusSeconds(600)));
        statement.setObject(12, commandId);
        statement.setString(13, idempotencyKey);
        statement.setString(14, requestHash);
        statement.setString(15, "CONCURRENCY_VERIFICATION");
        statement.setObject(
                16,
                UUID.fromString("92000000-0000-4000-8000-000000000021"));
        statement.setLong(17, 0L);
        try (ResultSet result = statement.executeQuery()) {
            if (!result.next()) {
                throw new SQLException("Start returned no authorization attempt");
            }
            return result.getObject(1, UUID.class);
        }
    }
}

boolean exists(Connection connection, String sql) throws SQLException {
    try (Statement statement = connection.createStatement();
         ResultSet result = statement.executeQuery(sql)) {
        return result.next() && result.getBoolean(1);
    }
}

try {
    Class.forName("org.postgresql.Driver");
    String url = requiredEnvironment("OTA_SPRINT2D_CONCURRENCY_JDBC_URL");
    String username =
            requiredEnvironment("OTA_SPRINT2D_CONCURRENCY_USERNAME");
    String password =
            requiredEnvironment("OTA_SPRINT2D_CONCURRENCY_PASSWORD");
    Path setupFile = Path.of(
            requiredEnvironment("OTA_SPRINT2D_CONCURRENCY_SETUP"));

    try (Connection setup = connection(url, username, password)) {
        setup.setAutoCommit(false);
        String setupSql = Files.readString(setupFile);
        for (String fragment : setupSql.split(
                "(?m)^-- @statement\\s*$")) {
            String statementSql = fragment.trim();
            if (!statementSql.isEmpty()) {
                try (Statement statement = setup.createStatement()) {
                    statement.execute(statementSql);
                }
            }
        }
        setup.commit();
    }

    CountDownLatch leaderLocked = new CountDownLatch(1);
    AtomicLong contenderWaitMilliseconds = new AtomicLong();
    ExecutorService executor = Executors.newFixedThreadPool(2);
    Future<Throwable> leader = executor.submit(() -> {
        try (Connection session = connection(url, username, password)) {
            session.setAutoCommit(false);
            bindActor(session);
            try (Statement statement = session.createStatement()) {
                statement.execute("set local statement_timeout = '5s'");
                statement.execute("""
                        select pg_advisory_xact_lock(
                            hashtextextended(
                                'browser-authorization-active|' ||
                                '92000000-0000-4000-8000-000000000001|' ||
                                '92000000-0000-4000-8000-000000000002|' ||
                                '92000000-0000-4000-8000-000000000005',
                                0
                            )
                        )
                        """);
            }
            leaderLocked.countDown();
            Thread.sleep(750);
            UUID created = startReauthentication(
                    session,
                    UUID.fromString(
                            "92000000-0000-4000-8000-000000000022"),
                    UUID.fromString(
                            "92000000-0000-4000-8000-000000000027"),
                    "sprint2d-concurrency-leader",
                    "3".repeat(64),
                    "4".repeat(64));
            if (!created.equals(UUID.fromString(
                    "92000000-0000-4000-8000-000000000022"))) {
                throw new SQLException("Leader created the wrong attempt");
            }
            session.commit();
            return null;
        } catch (Throwable failure) {
            leaderLocked.countDown();
            return failure;
        }
    });

    Future<Throwable> contender = executor.submit(() -> {
        try {
            if (!leaderLocked.await(5, TimeUnit.SECONDS)) {
                return new IllegalStateException(
                        "Leader did not acquire the connector lock");
            }
            long started = System.nanoTime();
            try (Connection session = connection(url, username, password)) {
                session.setAutoCommit(false);
                bindActor(session);
                try (Statement statement = session.createStatement()) {
                    statement.execute("set local statement_timeout = '5s'");
                }
                startReauthentication(
                        session,
                        UUID.fromString(
                                "92000000-0000-4000-8000-000000000023"),
                        UUID.fromString(
                                "92000000-0000-4000-8000-000000000028"),
                        "sprint2d-concurrency-contender",
                        "5".repeat(64),
                        "6".repeat(64));
                session.commit();
                return null;
            } catch (Throwable failure) {
                contenderWaitMilliseconds.set(
                        TimeUnit.NANOSECONDS.toMillis(
                                System.nanoTime() - started));
                return failure;
            }
        } catch (Throwable failure) {
            return failure;
        }
    });

    Throwable leaderFailure = leader.get(15, TimeUnit.SECONDS);
    Throwable contenderFailure = contender.get(15, TimeUnit.SECONDS);
    executor.shutdownNow();

    if (leaderFailure != null) {
        throw new IllegalStateException(
                "Concurrency leader failed",
                leaderFailure);
    }
    if (!(contenderFailure instanceof SQLException sqlFailure)
            || !"40001".equals(sqlFailure.getSQLState())
            || !sqlFailure.getMessage().toLowerCase(Locale.ROOT).contains(
                    "reauthentication predecessor row version conflict")) {
        throw new IllegalStateException(
                "Stale concurrent predecessor was not rejected by CAS",
                contenderFailure);
    }
    if (contenderWaitMilliseconds.get() < 500L) {
        throw new IllegalStateException(
                "Contender did not wait for the predecessor lock: "
                        + contenderWaitMilliseconds.get() + "ms");
    }

    try (Connection verification = connection(url, username, password)) {
        verification.setAutoCommit(false);
        bindActor(verification);
        if (!exists(verification, """
                select exists (
                    select 1
                      from ota.browser_authorization_attempt
                     where tenant_id =
                           '92000000-0000-4000-8000-000000000001'
                       and hotel_id =
                           '92000000-0000-4000-8000-000000000002'
                       and connector_id =
                           '92000000-0000-4000-8000-000000000005'
                       and authorization_attempt_id =
                           '92000000-0000-4000-8000-000000000021'
                       and state_code = 'EXPIRED'
                       and row_version = 1
                ) and exists (
                    select 1
                      from ota.browser_authorization_attempt
                     where tenant_id =
                           '92000000-0000-4000-8000-000000000001'
                       and hotel_id =
                           '92000000-0000-4000-8000-000000000002'
                       and connector_id =
                           '92000000-0000-4000-8000-000000000005'
                       and authorization_attempt_id =
                           '92000000-0000-4000-8000-000000000022'
                       and state_code = 'WAITING_FOR_OPERATOR'
                       and row_version = 0
                ) and not exists (
                    select 1
                      from ota.browser_authorization_attempt
                     where tenant_id =
                           '92000000-0000-4000-8000-000000000001'
                       and hotel_id =
                           '92000000-0000-4000-8000-000000000002'
                       and connector_id =
                           '92000000-0000-4000-8000-000000000005'
                       and authorization_attempt_id =
                           '92000000-0000-4000-8000-000000000023'
                ) and (
                    select count(*)
                      from ota.browser_authorization_attempt
                     where tenant_id =
                           '92000000-0000-4000-8000-000000000001'
                       and hotel_id =
                           '92000000-0000-4000-8000-000000000002'
                       and connector_id =
                           '92000000-0000-4000-8000-000000000005'
                       and state_code = 'WAITING_FOR_OPERATOR'
                ) = 1 and exists (
                    select 1
                      from ota.browser_authorization_command_receipt
                     where tenant_id =
                           '92000000-0000-4000-8000-000000000001'
                       and hotel_id =
                           '92000000-0000-4000-8000-000000000002'
                       and connector_id =
                           '92000000-0000-4000-8000-000000000005'
                       and authorization_attempt_id =
                           '92000000-0000-4000-8000-000000000022'
                       and predecessor_authorization_attempt_id =
                           '92000000-0000-4000-8000-000000000021'
                       and predecessor_expected_row_version = 0
                )
                """)) {
            throw new IllegalStateException(
                    "Concurrent predecessor CAS persistence assertion failed");
        }
        verification.rollback();
    }

    System.out.println(
            "PASS: Sprint 2D concurrent predecessor CAS waited "
                    + contenderWaitMilliseconds.get()
                    + "ms and rejected the stale contender.");
    System.exit(0);
} catch (Throwable failure) {
    failure.printStackTrace(System.err);
    System.exit(1);
}
