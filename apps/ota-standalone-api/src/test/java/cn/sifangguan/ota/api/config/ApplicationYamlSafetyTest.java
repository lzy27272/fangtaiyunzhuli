package cn.sifangguan.ota.api.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class ApplicationYamlSafetyTest {
    @Test
    void defaultsToIgnoringUntrustedForwardedHeaders() throws IOException {
        try (var input = getClass().getResourceAsStream("/application.yml")) {
            assertThat(input).isNotNull();
            String yaml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            assertThat(yaml).contains("forward-headers-strategy: none");
            assertThat(yaml).doesNotContain("forward-headers-strategy: framework");
            assertThat(yaml).contains("enabled: ${OTA_FLYWAY_ENABLED:false}");
        }
    }
}
