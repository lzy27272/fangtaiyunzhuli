package cn.sifangguan.ota.worker.browser;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;

class BrowserSessionBridgeBoundaryTest {
    @Test
    void bridgeContainsNoBrowserHttpOrSecretImplementation() throws IOException {
        var sourceRoot = Path.of(
                "src", "main", "java", "cn", "sifangguan", "ota", "worker", "browser");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(source.contains("java.net.http"), file + " may attempt HTTP");
                assertFalse(source.contains("RestClient"), file + " may attempt HTTP");
                assertFalse(source.contains("WebClient"), file + " may attempt HTTP");
                assertFalse(source.contains("HttpClient"), file + " may attempt HTTP");
                assertFalse(source.contains("Playwright"), file + " may drive a browser");
                assertFalse(source.contains("Selenium"), file + " may drive a browser");
                assertFalse(source.contains("implements SecretStorePort"),
                        file + " implements real secret access");
            }
        }
    }
}
