package cn.sifangguan.ota.contracts.openapi;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuthenticationOpenApiContractTest {
    private static final String RESOURCE = "openapi/ota-standalone-auth-v1.yaml";
    private static final Set<String> AUTH_PATHS = Set.of(
            "/api/v1/auth/login",
            "/api/v1/auth/refresh",
            "/api/v1/auth/logout",
            "/api/v1/auth/me");

    @Test
    void publishesOpenApi31WithOnlyImplementedSprintZeroAuthenticationPaths() throws IOException {
        var contract = contract();
        assertTrue(contract.contains("openapi: 3.1.0"));
        assertTrue(contract.contains("version: 0.1.0-sprint0"));

        var matcher = Pattern.compile("^  (/api/v1/[^:]+):$", Pattern.MULTILINE).matcher(contract);
        var actualPaths = new LinkedHashSet<String>();
        while (matcher.find()) {
            actualPaths.add(matcher.group(1));
        }
        assertEquals(AUTH_PATHS, actualPaths);
        assertFalse(contract.contains("/hotels/"));
        assertFalse(contract.contains("/connectors/"));
        assertFalse(contract.contains("/briefs"));
        assertFalse(contract.contains("/incidents"));
    }

    @Test
    void freezesTokenCookieCsrfProblemAndCacheContracts() throws IOException {
        var contract = contract();
        for (var required : Set.of(
                "bearerAccess:",
                "refreshCookie:",
                "csrfCookie:",
                "csrfHeader:",
                "name: ota_refresh",
                "name: ota_csrf",
                "name: X-CSRF-TOKEN",
                "application/problem+json:",
                "const: no-store",
                "Set-Cookie:",
                "HttpOnly, Secure, SameSite=Strict")) {
            assertTrue(contract.contains(required), () -> "missing OpenAPI contract term: " + required);
        }
        assertTrue(contract.contains("Authorization: Bearer"));
        assertTrue(contract.contains("must remain in browser memory"));
    }

    @Test
    void fieldCookieAndProblemNamesMatchCurrentWebAndApiSources() throws IOException {
        var contract = contract();
        var repository = findRepositoryRoot();
        var controller = read(repository.resolve(
                "apps/ota-standalone-api/src/main/java/cn/sifangguan/ota/api/auth/web/AuthController.java"));
        var securityProperties = read(repository.resolve(
                "apps/ota-standalone-api/src/main/java/cn/sifangguan/ota/api/config/OtaSecurityProperties.java"));
        var exceptionHandler = read(repository.resolve(
                "apps/ota-standalone-api/src/main/java/cn/sifangguan/ota/api/auth/web/AuthExceptionHandler.java"));
        var accessFilter = read(repository.resolve(
                "apps/ota-standalone-api/src/main/java/cn/sifangguan/ota/api/auth/web/AccessTokenAuthenticationFilter.java"));
        var webSecurity = read(repository.resolve(
                "apps/ota-standalone-api/src/main/java/cn/sifangguan/ota/api/config/WebSecurityConfiguration.java"));
        var webSession = read(repository.resolve(
                "apps/ota-standalone-web/src/auth/session.ts"));
        var webAuth = read(repository.resolve(
                "apps/ota-standalone-web/src/api/auth.ts"));

        for (var field : Set.of("username", "password", "accessToken", "expiresInSeconds", "account")) {
            assertTrue(controller.contains(field), () -> "API field missing: " + field);
            assertTrue(contract.contains("        " + field + ":"), () -> "OpenAPI field missing: " + field);
        }
        for (var field : Set.of("id", "displayName", "roles")) {
            assertTrue(controller.contains(field), () -> "API account field missing: " + field);
            assertTrue(webSession.contains(field), () -> "Web account field missing: " + field);
            assertTrue(contract.contains("        " + field + ":"), () -> "OpenAPI account field missing: " + field);
        }
        for (var cookieName : Set.of("ota_refresh", "ota_csrf")) {
            assertTrue(securityProperties.contains(cookieName));
            assertTrue(contract.contains("name: " + cookieName));
        }
        for (var code : Set.of(
                "AUTHENTICATION_REJECTED",
                "LOGIN_RATE_LIMITED",
                "REQUEST_VERIFICATION_FAILED",
                "INVALID_REQUEST",
                "AUTHENTICATION_REQUIRED",
                "INVALID_ACCESS_TOKEN")) {
            assertTrue(exceptionHandler.contains(code) || accessFilter.contains(code) || webSecurity.contains(code));
            assertTrue(contract.contains("code: " + code));
        }

        assertTrue(webAuth.contains("X-CSRF-TOKEN"));
        assertTrue(webAuth.contains("credentials: 'include'"));
        assertFalse(webAuth.contains("logout(accessToken"));
    }

    private static String contract() throws IOException {
        try (var stream = AuthenticationOpenApiContractTest.class.getClassLoader().getResourceAsStream(RESOURCE)) {
            assertNotNull(stream, RESOURCE + " must be packaged");
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static Path findRepositoryRoot() {
        Path candidate = Path.of("").toAbsolutePath().normalize();
        while (candidate != null && !Files.isRegularFile(candidate.resolve("ota-platform-pom.xml"))) {
            candidate = candidate.getParent();
        }
        assertNotNull(candidate, "repository root containing ota-platform-pom.xml was not found");
        return candidate;
    }

    private static String read(Path path) throws IOException {
        assertTrue(Files.isRegularFile(path), () -> "missing source used by contract drift test: " + path);
        return Files.readString(path, StandardCharsets.UTF_8);
    }
}
