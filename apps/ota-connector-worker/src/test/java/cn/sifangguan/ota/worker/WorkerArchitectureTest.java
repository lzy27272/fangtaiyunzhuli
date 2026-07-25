package cn.sifangguan.ota.worker;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class WorkerArchitectureTest {
    @Test
    void workerDoesNotCompileAgainstAiPlatformOrUngatedDatabaseImplementation()
            throws IOException {
        var sourceRoot = Path.of("src", "main", "java");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(source.contains("cn.sifangguan.hotelaios"), file + " depends on the AI platform");
                if (source.contains("import java.sql.")
                        || source.contains("import javax.sql.")) {
                    var normalized = file.toString().replace('\\', '/');
                    assertTrue(
                            normalized.contains("/simulation/persistence/")
                                    || normalized.endsWith(
                                            "/simulation/config/"
                                                    + "Sprint1SimulationJdbcConfiguration.java"),
                            file + " bypasses the gated Sprint 1 simulation persistence boundary");
                }
            }
        }
    }

    @Test
    void productionSourcesContainNoMockConnector() throws IOException {
        var sourceRoot = Path.of("src", "main", "java");
        try (var paths = Files.walk(sourceRoot)) {
            var mockSource = paths
                    .filter(path -> path.getFileName().toString().contains("MockConnector"))
                    .findAny();
            assertFalse(mockSource.isPresent(), "mock connectors belong in test fixtures only");
        }
    }

    @Test
    void simulationSourcesContainNoExternalDeliveryOrHttpClient() throws IOException {
        var sourceRoot = Path.of("src", "main", "java", "cn", "sifangguan", "ota", "worker", "simulation");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(source.contains("RestClient"), file + " may attempt HTTP");
                assertFalse(source.contains("WebClient"), file + " may attempt HTTP");
                assertFalse(source.contains("HttpClient"), file + " may attempt HTTP");
                assertFalse(source.contains("MessageDeliveryPort"), file + " may deliver externally");
                assertFalse(source.contains("SecretStorePort"), file + " may read real credentials");
            }
        }
    }

    @Test
    void fileFixtureContainsNoNetworkCredentialOrHostFileAccess()
            throws IOException {
        var sourceRoot = Path.of(
                "src", "main", "java", "cn", "sifangguan", "ota",
                "worker", "filefixture");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(
                    path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(source.contains("RestClient"), file + " may attempt HTTP");
                assertFalse(source.contains("WebClient"), file + " may attempt HTTP");
                assertFalse(source.contains("HttpClient"), file + " may attempt HTTP");
                assertFalse(source.contains("SecretStorePort"), file + " may read credentials");
                assertFalse(source.contains("Files.read"), file + " may read an arbitrary host file");
                assertFalse(source.contains("Path.of"), file + " may interpret a host path");
            }
        }
    }
}
