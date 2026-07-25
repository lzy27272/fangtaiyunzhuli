package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertFalse;

class BrowserSessionHelperBoundaryTest {
    private static final List<String> FORBIDDEN_SOURCE_MARKERS = List.of(
            "java.net.http",
            "RestClient",
            "RestTemplate",
            "WebClient",
            "HttpClient",
            "Playwright",
            "Selenium",
            "implements SecretStorePort");

    @Test
    void mainSourcesContainNoNetworkBrowserOrSecretStoreImplementation()
            throws IOException {
        var sourceRoot = Path.of("src", "main", "java");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                for (var marker : FORBIDDEN_SOURCE_MARKERS) {
                    assertFalse(
                            source.contains(marker),
                            file + " contains forbidden runtime marker " + marker);
                }
            }
        }
    }

    @Test
    void moduleDeclaresNoRuntimeDependency() throws IOException {
        var pom = Files.readString(Path.of("pom.xml"), StandardCharsets.UTF_8);

        assertFalse(pom.contains("spring-boot-starter-web"));
        assertFalse(pom.contains("playwright"));
        assertFalse(pom.contains("selenium"));
        assertFalse(pom.contains("okhttp"));
        assertFalse(pom.contains("httpclient"));
        assertFalse(pom.contains("ota-contracts"));
    }
}
