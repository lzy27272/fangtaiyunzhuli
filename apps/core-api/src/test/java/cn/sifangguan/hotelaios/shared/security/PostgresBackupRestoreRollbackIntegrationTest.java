package cn.sifangguan.hotelaios.shared.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;

import javax.sql.DataSource;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

@EnabledIfSystemProperty(named = "release.database-drill", matches = "true")
class PostgresBackupRestoreRollbackIntegrationTest {

    private static final String SENTINEL = "TECH-V0.2-before-backup";
    private static final ObjectMapper JSON = new ObjectMapper().findAndRegisterModules();

    @Test
    void coldPhysicalBackupRestoresV16AndRollsBackPostBackupMutation() throws Exception {
        String runId = safeName(System.getProperty("release.drill-run-id", "manual"));
        Path evidenceDir = requiredDirectory("release.evidence-dir");
        Path drillRoot = Path.of(System.getProperty("java.io.tmpdir"), "hotel-ai-os-release-db-drill", runId)
                .toAbsolutePath().normalize();
        Path source = drillRoot.resolve("source");
        Path backup = drillRoot.resolve("backup");
        Path restored = drillRoot.resolve("restored");
        recreateDirectory(drillRoot);
        Files.createDirectories(evidenceDir);

        try {
            Instant startedAt = Instant.now();
            int migrationsExecuted;
            try (EmbeddedPostgres postgres = start(source)) {
            DataSource owner = postgres.getPostgresDatabase();
            createRuntimeRole(owner);
            migrationsExecuted = Flyway.configure()
                    .dataSource(owner)
                    .locations("classpath:db/migration")
                    .cleanDisabled(true)
                    .load()
                    .migrate()
                    .migrationsExecuted;
            assertEquals(16, migrationsExecuted);
            execute(owner, """
                    create table release_drill_marker (
                      marker varchar(80) primary key,
                      payload varchar(160) not null,
                      created_at timestamptz not null default now()
                    )
                    """);
            execute(owner, "insert into release_drill_marker(marker, payload) values ('checkpoint', '" + SENTINEL + "')");
            assertEquals(SENTINEL, scalarString(owner, "select payload from release_drill_marker where marker = 'checkpoint'"));
        }

        copyDirectory(source, backup);
        Snapshot backupSnapshot = snapshot(backup);
        assertTrue(backupSnapshot.fileCount() > 0);
        assertTrue(backupSnapshot.totalBytes() > 0);

        try (EmbeddedPostgres postgres = start(source)) {
            DataSource owner = postgres.getPostgresDatabase();
            execute(owner, "update release_drill_marker set payload = 'post-backup-mutation' where marker = 'checkpoint'");
            execute(owner, "insert into release_drill_marker(marker, payload) values ('created-after-backup', 'must-not-survive')");
            assertEquals("post-backup-mutation", scalarString(owner,
                    "select payload from release_drill_marker where marker = 'checkpoint'"));
        }

        copyDirectory(backup, restored);
        Snapshot restoredBeforeStart = snapshot(restored);
        assertEquals(backupSnapshot.digest(), restoredBeforeStart.digest());
        assertEquals(backupSnapshot.fileCount(), restoredBeforeStart.fileCount());
        assertEquals(backupSnapshot.totalBytes(), restoredBeforeStart.totalBytes());

        Map<String, Object> verification = new LinkedHashMap<>();
        try (EmbeddedPostgres postgres = start(restored)) {
            DataSource owner = postgres.getPostgresDatabase();
            verification.put("postgresVersion", scalarString(owner, "select version()"));
            verification.put("dataChecksums", scalarString(owner, "show data_checksums"));
            verification.put("flywayVersion", scalarString(owner,
                    "select version from flyway_schema_history where success order by installed_rank desc limit 1"));
            verification.put("successfulMigrations", scalarInt(owner,
                    "select count(*) from flyway_schema_history where success"));
            verification.put("forcedRlsTables", scalarInt(owner, """
                    select count(*)
                      from pg_class c
                      join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind = 'r'
                       and c.relrowsecurity and c.relforcerowsecurity
                    """));
            verification.put("runtimeRoleSuperuser", scalarBoolean(owner,
                    "select rolsuper from pg_roles where rolname = 'hotel_ai_os_app'"));
            verification.put("runtimeRoleBypassRls", scalarBoolean(owner,
                    "select rolbypassrls from pg_roles where rolname = 'hotel_ai_os_app'"));
            verification.put("restoredPayload", scalarString(owner,
                    "select payload from release_drill_marker where marker = 'checkpoint'"));
            verification.put("postBackupRows", scalarInt(owner,
                    "select count(*) from release_drill_marker where marker = 'created-after-backup'"));
            verification.put("seedTenantRows", scalarInt(owner,
                    "select count(*) from tenant where id = '10000000-0000-0000-0000-000000000001'::uuid"));

            assertEquals("16", verification.get("flywayVersion"));
            assertEquals(16, verification.get("successfulMigrations"));
            assertTrue((Integer) verification.get("forcedRlsTables") >= 49);
            assertFalse((Boolean) verification.get("runtimeRoleSuperuser"));
            assertFalse((Boolean) verification.get("runtimeRoleBypassRls"));
            assertEquals(SENTINEL, verification.get("restoredPayload"));
            assertEquals(0, verification.get("postBackupRows"));
            assertEquals(1, verification.get("seedTenantRows"));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("schemaVersion", 1);
        result.put("status", "PASS");
        result.put("runId", runId);
        result.put("startedAt", startedAt.toString());
        result.put("completedAt", Instant.now().toString());
        result.put("drillType", "cold-physical-backup-restore-point-in-time-rollback");
        result.put("scope", "local-embedded-postgresql-release-rehearsal");
        result.put("migrationsExecutedOnFreshCluster", migrationsExecuted);
        result.put("backup", Map.of(
                "fileCount", backupSnapshot.fileCount(),
                "totalBytes", backupSnapshot.totalBytes(),
                "contentManifestSha256", backupSnapshot.digest()
        ));
        result.put("restoreCopyMatchedBackupBeforeStartup", true);
        result.put("verification", verification);
        result.put("limitations", List.of(
                "This is a local embedded PostgreSQL physical cold-backup rehearsal, not a signed target-environment operation.",
                "Production/UAT persistent target infrastructure must separately prove scheduled backup, retention, encryption, monitoring and operator-approved rollback."
        ));
        JSON.writerWithDefaultPrettyPrinter().writeValue(
                evidenceDir.resolve("database-recovery-drill.json").toFile(), result);

        } finally {
            deleteDirectory(drillRoot);
        }
    }

    private static EmbeddedPostgres start(Path dataDirectory) throws IOException {
        return EmbeddedPostgres.builder()
                .setDataDirectory(dataDirectory)
                .setCleanDataDirectory(false)
                .setRegisterShutdownHook(false)
                .start();
    }

    private static void createRuntimeRole(DataSource dataSource) throws Exception {
        execute(dataSource, """
                do $$ begin
                  if not exists (select 1 from pg_roles where rolname = 'hotel_ai_os_app') then
                    create role hotel_ai_os_app login password 'release-drill-only'
                      nosuperuser nocreatedb nocreaterole noinherit;
                  end if;
                end $$
                """);
    }

    private static Path requiredDirectory(String property) {
        String value = System.getProperty(property);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing system property: " + property);
        }
        return Path.of(value).toAbsolutePath().normalize();
    }

    private static String safeName(String value) {
        return value.replaceAll("[^A-Za-z0-9._-]", "-");
    }

    private static void execute(DataSource dataSource, String sql) throws Exception {
        try (var connection = dataSource.getConnection(); var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static int scalarInt(DataSource dataSource, String sql) throws Exception {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getInt(1);
        }
    }

    private static boolean scalarBoolean(DataSource dataSource, String sql) throws Exception {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getBoolean(1);
        }
    }

    private static String scalarString(DataSource dataSource, String sql) throws Exception {
        try (var connection = dataSource.getConnection();
             var statement = connection.createStatement();
             var result = statement.executeQuery(sql)) {
            assertTrue(result.next());
            return result.getString(1);
        }
    }

    private static void recreateDirectory(Path directory) throws IOException {
        deleteDirectory(directory);
        Files.createDirectories(directory);
    }

    private static void deleteDirectory(Path directory) throws IOException {
        if (!Files.exists(directory)) { return; }
        try (var paths = Files.walk(directory)) {
            for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.deleteIfExists(path);
            }
        }
    }

    private static void copyDirectory(Path source, Path target) throws IOException {
        if (Files.exists(target)) { deleteDirectory(target); }
        try (var paths = Files.walk(source)) {
            for (Path path : paths.sorted().toList()) {
                Path destination = target.resolve(source.relativize(path).toString());
                if (Files.isDirectory(path)) {
                    Files.createDirectories(destination);
                } else {
                    Files.copy(path, destination, StandardCopyOption.COPY_ATTRIBUTES);
                }
            }
        }
    }

    private static Snapshot snapshot(Path directory) throws Exception {
        MessageDigest aggregate = MessageDigest.getInstance("SHA-256");
        List<Path> files;
        try (var paths = Files.walk(directory)) {
            files = paths.filter(Files::isRegularFile).sorted().toList();
        }
        long totalBytes = 0;
        for (Path file : files) {
            BasicFileAttributes attributes = Files.readAttributes(file, BasicFileAttributes.class);
            totalBytes += attributes.size();
            String relative = directory.relativize(file).toString().replace('\\', '/');
            aggregate.update(relative.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            aggregate.update((byte) 0);
            aggregate.update(Files.readAllBytes(file));
            aggregate.update((byte) 0);
        }
        return new Snapshot(files.size(), totalBytes, HexFormat.of().formatHex(aggregate.digest()));
    }

    private record Snapshot(int fileCount, long totalBytes, String digest) {}
}
