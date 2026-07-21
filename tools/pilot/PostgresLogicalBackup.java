import org.postgresql.copy.CopyManager;
import org.postgresql.core.BaseConnection;

import java.io.BufferedWriter;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;

public final class PostgresLogicalBackup {
    private PostgresLogicalBackup() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("Usage: PostgresLogicalBackup <jdbc-url> <output-directory>");
        }
        String jdbcUrl = args[0];
        Path output = Path.of(args[1]).toAbsolutePath().normalize();
        Files.createDirectories(output);

        String owner = required("PILOT_DB_OWNER");
        String password = required("PILOT_DB_OWNER_PASSWORD");
        try (Connection connection = DriverManager.getConnection(jdbcUrl, owner, password)) {
            connection.setAutoCommit(false);
            connection.setTransactionIsolation(Connection.TRANSACTION_REPEATABLE_READ);
            connection.setReadOnly(true);
            exportSnapshot(connection, output);
            connection.commit();
        }
        System.out.println("POSTGRES_LOGICAL_BACKUP_OK directory=" + output);
    }

    private static void exportSnapshot(Connection connection, Path output) throws Exception {
        List<TableRef> tables = new ArrayList<>();
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("""
                     select n.nspname, c.relname
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                     where c.relkind in ('r', 'p')
                       and n.nspname not in ('pg_catalog', 'information_schema')
                       and n.nspname not like 'pg_toast%'
                     order by n.nspname, c.relname
                     """)) {
            while (result.next()) {
                tables.add(new TableRef(result.getString(1), result.getString(2)));
            }
        }

        CopyManager copy = new CopyManager(connection.unwrap(BaseConnection.class));
        Path manifest = output.resolve("manifest.tsv");
        try (BufferedWriter writer = Files.newBufferedWriter(manifest, StandardCharsets.UTF_8)) {
            writer.write("schema\ttable\tfile\trows\tsha256");
            writer.newLine();
            int index = 0;
            for (TableRef table : tables) {
                index++;
                String fileName = String.format(Locale.ROOT, "%04d_%s_%s.csv", index,
                        safeFilePart(table.schema()), safeFilePart(table.table()));
                Path destination = output.resolve(fileName);
                long rows;
                try (OutputStream stream = Files.newOutputStream(destination)) {
                    rows = copy.copyOut("copy " + qualified(table)
                            + " to stdout with (format csv, header true, encoding 'UTF8')", stream);
                }
                writer.write(table.schema());
                writer.write('\t');
                writer.write(table.table());
                writer.write('\t');
                writer.write(fileName);
                writer.write('\t');
                writer.write(Long.toString(rows));
                writer.write('\t');
                writer.write(sha256(destination));
                writer.newLine();
            }
        }

        exportSequences(connection, output.resolve("sequences.sql"));
        String flywayVersion = queryScalar(connection,
                "select coalesce(max(version::int), 0)::text from flyway_schema_history where success");
        String databaseVersion = queryScalar(connection, "select version()");
        Files.writeString(output.resolve("metadata.txt"),
                "createdAt=" + OffsetDateTime.now() + System.lineSeparator()
                        + "flywayVersion=" + flywayVersion + System.lineSeparator()
                        + "databaseVersion=" + databaseVersion + System.lineSeparator()
                        + "isolation=REPEATABLE_READ_READ_ONLY" + System.lineSeparator(),
                StandardCharsets.UTF_8);
    }

    private static void exportSequences(Connection connection, Path destination) throws Exception {
        List<TableRef> sequences = new ArrayList<>();
        try (Statement statement = connection.createStatement();
             ResultSet result = statement.executeQuery("""
                     select n.nspname, c.relname
                     from pg_class c
                     join pg_namespace n on n.oid = c.relnamespace
                     where c.relkind = 'S'
                       and n.nspname not in ('pg_catalog', 'information_schema')
                     order by n.nspname, c.relname
                     """)) {
            while (result.next()) {
                sequences.add(new TableRef(result.getString(1), result.getString(2)));
            }
        }
        try (BufferedWriter writer = Files.newBufferedWriter(destination, StandardCharsets.UTF_8)) {
            writer.write("-- Sequence state captured in the same repeatable-read snapshot.");
            writer.newLine();
            for (TableRef sequence : sequences) {
                try (Statement statement = connection.createStatement();
                     ResultSet result = statement.executeQuery("select last_value, is_called from " + qualified(sequence))) {
                    if (result.next()) {
                        String regclass = (sequence.schema() + "." + sequence.table()).replace("'", "''");
                        writer.write("select setval('" + regclass + "'::regclass, "
                                + result.getLong(1) + ", " + result.getBoolean(2) + ");");
                        writer.newLine();
                    }
                }
            }
        }
    }

    private static String queryScalar(Connection connection, String sql) throws Exception {
        try (Statement statement = connection.createStatement(); ResultSet result = statement.executeQuery(sql)) {
            if (!result.next()) {
                throw new IllegalStateException("Metadata query returned no row");
            }
            return result.getString(1).replace('\r', ' ').replace('\n', ' ');
        }
    }

    private static String qualified(TableRef table) {
        return quoteIdentifier(table.schema()) + "." + quoteIdentifier(table.table());
    }

    private static String quoteIdentifier(String value) {
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static String safeFilePart(String value) {
        return value.replaceAll("[^A-Za-z0-9_.-]", "_");
    }

    private static String sha256(Path file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var stream = Files.newInputStream(file)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = stream.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Missing environment variable: " + name);
        }
        return value;
    }

    private record TableRef(String schema, String table) {
    }
}
