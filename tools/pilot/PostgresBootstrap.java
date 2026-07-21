import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.Locale;

public final class PostgresBootstrap {
    private PostgresBootstrap() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            throw new IllegalArgumentException("Usage: PostgresBootstrap <bootstrap|run-script|verify> <jdbc-url> [argument]");
        }
        String command = args[0];
        String jdbcUrl = args[1];
        String owner = required("PILOT_DB_OWNER");
        String ownerPassword = required("PILOT_DB_OWNER_PASSWORD");
        switch (command) {
            case "bootstrap" -> bootstrap(jdbcUrl, owner, ownerPassword);
            case "run-script" -> {
                if (args.length != 3) throw new IllegalArgumentException("run-script requires a SQL file path");
                runScript(jdbcUrl, owner, ownerPassword, Path.of(args[2]));
            }
            case "verify" -> verify(jdbcUrl, owner, ownerPassword);
            default -> throw new IllegalArgumentException("Unknown command: " + command);
        }
    }

    private static void bootstrap(String adminJdbcUrl, String owner, String ownerPassword) throws Exception {
        String database = identifier(required("PILOT_DB_NAME"));
        String runtimeUser = identifier(required("PILOT_DB_RUNTIME_USER"));
        String runtimePassword = required("PILOT_DB_RUNTIME_PASSWORD");
        try (Connection connection = DriverManager.getConnection(adminJdbcUrl, owner, ownerPassword);
             Statement statement = connection.createStatement()) {
            if (!exists(statement, "select 1 from pg_database where datname = '" + literal(database) + "'")) {
                statement.execute("create database " + quoteIdentifier(database) + " owner " + quoteIdentifier(owner));
            }
            if (!exists(statement, "select 1 from pg_roles where rolname = '" + literal(runtimeUser) + "'")) {
                statement.execute("create role " + quoteIdentifier(runtimeUser)
                        + " login password '" + literal(runtimePassword)
                        + "' nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
            } else {
                statement.execute("alter role " + quoteIdentifier(runtimeUser) + " password '" + literal(runtimePassword)
                        + "' nosuperuser nocreatedb nocreaterole noinherit nobypassrls");
            }
            statement.execute("grant connect on database " + quoteIdentifier(database) + " to " + quoteIdentifier(runtimeUser));
        }
        System.out.println("POSTGRES_BOOTSTRAP_OK database=" + database + " runtimeRole=" + runtimeUser);
    }

    private static void runScript(String jdbcUrl, String owner, String ownerPassword, Path sqlFile) throws Exception {
        String sql = Files.readString(sqlFile, StandardCharsets.UTF_8)
                .replaceAll("(?m)^\\\\.*(?:\\R|$)", "");
        try (Connection connection = DriverManager.getConnection(jdbcUrl, owner, ownerPassword);
             Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
        System.out.println("POSTGRES_SCRIPT_OK file=" + sqlFile.getFileName());
    }

    private static void verify(String jdbcUrl, String owner, String ownerPassword) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl, owner, ownerPassword);
             Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("""
                     select version(),
                            (select max(version::int) from flyway_schema_history where success),
                            (select count(*) from user_account where tenant_id = '10000000-0000-0000-0000-000000000001'::uuid),
                            (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                              where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity)
                     """)) {
            if (!result.next()) throw new IllegalStateException("PostgreSQL verification returned no row");
            System.out.printf(Locale.ROOT,
                    "POSTGRES_VERIFY_OK version=%s flyway=%d accounts=%d forcedRlsTables=%d%n",
                    result.getString(1).split(",")[0], result.getInt(2), result.getInt(3), result.getInt(4));
        }
    }

    private static boolean exists(Statement statement, String sql) throws Exception {
        try (ResultSet result = statement.executeQuery(sql)) {
            return result.next();
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + name);
        return value;
    }

    private static String identifier(String value) {
        if (!value.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new IllegalArgumentException("Unsafe SQL identifier");
        return value;
    }

    private static String quoteIdentifier(String value) {
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static String literal(String value) {
        return value.replace("'", "''");
    }
}
