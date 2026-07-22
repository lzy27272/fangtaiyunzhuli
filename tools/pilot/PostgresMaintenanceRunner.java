import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLWarning;
import java.sql.Statement;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Executes the guarded Pilot maintenance SQL when a PostgreSQL client binary is
 * not installed. Only the small psql conditional subset used by the checked-in
 * maintenance script is accepted; unknown meta commands fail closed.
 */
public final class PostgresMaintenanceRunner {
    private PostgresMaintenanceRunner() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 4) {
            throw new IllegalArgumentException(
                    "Usage: PostgresMaintenanceRunner <jdbc-url> <sql-file> <true|false> <confirmation>");
        }
        boolean execute = switch (args[2]) {
            case "true" -> true;
            case "false" -> false;
            default -> throw new IllegalArgumentException("execute must be true or false");
        };
        String confirmation = "-".equals(args[3]) ? "" : args[3];
        if (execute && !"DELETE-PILOT-UAT-ONLY".equals(confirmation)) {
            throw new IllegalArgumentException("execute mode requires the exact confirmation");
        }

        String source = Files.readString(Path.of(args[1]), StandardCharsets.UTF_8);
        String sql = preprocess(source, execute, confirmation);
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"));
             Statement statement = connection.createStatement()) {
            connection.setAutoCommit(true);
            boolean hasResult = statement.execute(sql);
            while (true) {
                if (hasResult) {
                    print(statement.getResultSet());
                } else if (statement.getUpdateCount() == -1) {
                    break;
                }
                hasResult = statement.getMoreResults();
            }
            printWarnings(statement.getWarnings());
        }
        System.out.println(execute
                ? "PILOT_UAT_CLEANUP_EXECUTED_AND_VERIFIED"
                : "PILOT_UAT_CLEANUP_DRY_RUN_COMPLETE");
    }

    private static String preprocess(String source, boolean execute, String confirmation) {
        StringBuilder sql = new StringBuilder(source.length());
        Deque<Conditional> conditions = new ArrayDeque<>();
        for (String line : source.split("\\R", -1)) {
            String trimmed = line.trim();
            if (trimmed.startsWith("\\if ")) {
                String expression = trimmed.substring(4).trim();
                boolean value = switch (expression) {
                    case ":{?cleanup_execute}", ":{?cleanup_confirmation}" -> true;
                    case ":cleanup_execute" -> execute;
                    default -> throw new IllegalArgumentException("Unsupported psql conditional: " + expression);
                };
                conditions.push(new Conditional(value, value));
                continue;
            }
            if (trimmed.equals("\\else")) {
                if (conditions.isEmpty()) throw new IllegalArgumentException("Unexpected psql else");
                Conditional current = conditions.pop();
                conditions.push(new Conditional(current.condition(), !current.included()));
                continue;
            }
            if (trimmed.equals("\\endif")) {
                if (conditions.isEmpty()) throw new IllegalArgumentException("Unexpected psql endif");
                conditions.pop();
                continue;
            }
            boolean included = conditions.stream().allMatch(Conditional::included);
            if (trimmed.startsWith("\\")) {
                if (trimmed.startsWith("\\set ") || trimmed.startsWith("\\echo ")) continue;
                throw new IllegalArgumentException("Unsupported psql meta command: " + trimmed);
            }
            if (included) {
                sql.append(line
                        .replace(":'cleanup_execute'", quote(Boolean.toString(execute)))
                        .replace(":'cleanup_confirmation'", quote(confirmation)))
                        .append(System.lineSeparator());
            }
        }
        if (!conditions.isEmpty()) throw new IllegalArgumentException("Unclosed psql conditional");
        return sql.toString();
    }

    private static String quote(String value) {
        return "'" + value.replace("'", "''") + "'";
    }

    private static void print(ResultSet result) throws Exception {
        try (result) {
            ResultSetMetaData metadata = result.getMetaData();
            int columns = metadata.getColumnCount();
            StringBuilder header = new StringBuilder("RESULT");
            for (int i = 1; i <= columns; i++) header.append('\t').append(metadata.getColumnLabel(i));
            System.out.println(header);
            while (result.next()) {
                StringBuilder row = new StringBuilder("ROW");
                for (int i = 1; i <= columns; i++) row.append('\t').append(result.getString(i));
                System.out.println(row);
            }
        }
    }

    private static void printWarnings(SQLWarning warning) {
        for (SQLWarning current = warning; current != null; current = current.getNextWarning()) {
            System.out.println("NOTICE\t" + current.getMessage().replace('\r', ' ').replace('\n', ' '));
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + name);
        return value;
    }

    private record Conditional(boolean condition, boolean included) {
    }
}
