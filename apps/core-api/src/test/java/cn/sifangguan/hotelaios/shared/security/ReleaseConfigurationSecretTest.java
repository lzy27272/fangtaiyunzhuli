package cn.sifangguan.hotelaios.shared.security;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class ReleaseConfigurationSecretTest {

    private static final Pattern PASSWORD_WITH_FALLBACK = Pattern.compile(
            "(?m)^\\s*password:\\s*\\$\\{(?:DB_PASSWORD|DB_MIGRATION_PASSWORD):[^}]+}$");

    @Test
    void databasePasswordsAreRequiredExternalValuesWithoutPackagedFallbacks() throws IOException {
        String yaml;
        try (InputStream input = ReleaseConfigurationSecretTest.class.getResourceAsStream("/application.yml")) {
            assertThat(input).as("application.yml must be available on the test classpath").isNotNull();
            yaml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }

        assertThat(yaml).contains("password: ${DB_PASSWORD}");
        assertThat(yaml).contains("password: ${DB_MIGRATION_PASSWORD}");
        assertThat(PASSWORD_WITH_FALLBACK.matcher(yaml).find())
                .as("release configuration must not package database password fallback values")
                .isFalse();
    }
}
