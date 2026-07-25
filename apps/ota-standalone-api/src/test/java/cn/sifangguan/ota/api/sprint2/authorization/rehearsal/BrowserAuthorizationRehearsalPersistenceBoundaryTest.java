package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class BrowserAuthorizationRehearsalPersistenceBoundaryTest {
    @Test
    void migrationPersistsOnlyOfflineAuthRequiredRehearsalState()
            throws Exception {
        String sql = resourceText(
                "/db/migration/"
                        + "V6__sprint2d_offline_manual_authorization_rehearsal.sql");
        String lower = sql.toLowerCase(Locale.ROOT);

        assertThat(sql)
                .contains(
                        "OFFLINE_REHEARSAL",
                        "AUTH_REQUIRED",
                        "WAITING_FOR_OPERATOR",
                        "OFFLINE_REHEARSAL_COMPLETE",
                        "FORCE ROW LEVEL SECURITY",
                        "start_browser_authorization_rehearsal",
                        "transition_browser_authorization_rehearsal",
                        "CONFIGURATION_ONLY",
                        "CONTROLLED_BROWSER",
                        "BROWSER_SESSION")
                .doesNotContain(
                        "'AUTHORIZED'",
                        "'ACTIVE'",
                        "'VALID'",
                        "connector_collection_schedule",
                        "connector_collection_run",
                        "ota_job_registry");
        assertThat(lower)
                .doesNotContain(
                        "cookie_value",
                        "raw_cookie",
                        "password_value",
                        "raw_password",
                        "access_token",
                        "refresh_token",
                        "authorization_header",
                        "storage_state",
                        "secret_ref ");
    }

    @Test
    void jdbcAdapterHasNoOutboundOrCredentialResolutionCapability()
            throws Exception {
        String bytecode = resourceText(
                "/cn/sifangguan/ota/api/sprint2/authorization/rehearsal/"
                        + "JdbcBrowserAuthorizationRehearsalPort.class");
        assertThat(bytecode)
                .contains(
                        "start_browser_authorization_rehearsal",
                        "transition_browser_authorization_rehearsal",
                        "set_config",
                        "app.account_id",
                        "app.auth_session_id")
                .doesNotContain(
                        "RestTemplate",
                        "WebClient",
                        "HttpClient",
                        "ProcessBuilder",
                        "Playwright",
                        "Selenium",
                        "SecretValueProvider",
                        "secret_ref",
                        "interaction_reference_hash from");
    }

    private String resourceText(String path) throws Exception {
        try (var input = getClass().getResourceAsStream(path)) {
            assertThat(input).as(path).isNotNull();
            return new String(
                    input.readAllBytes(),
                    path.endsWith(".class")
                            ? StandardCharsets.ISO_8859_1
                            : StandardCharsets.UTF_8);
        }
    }
}
