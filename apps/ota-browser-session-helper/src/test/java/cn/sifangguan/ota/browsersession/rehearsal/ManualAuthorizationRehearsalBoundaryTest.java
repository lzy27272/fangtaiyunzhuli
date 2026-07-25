package cn.sifangguan.ota.browsersession.rehearsal;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.lang.reflect.RecordComponent;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ManualAuthorizationRehearsalBoundaryTest {
    private static final List<Class<?>> DTO_TYPES = List.of(
            ManualAuthorizationRehearsalIdentity.class,
            ManualAuthorizationRehearsalRequestBinding.class,
            ManualAuthorizationRehearsalCommand.class,
            ManualAuthorizationRehearsalQuery.class,
            ManualAuthorizationRehearsalSnapshot.class,
            ManualAuthorizationPreparation.class,
            ManualAuthorizationRehearsalView.class);
    private static final Set<String> FORBIDDEN_COMPONENT_NAMES = Set.of(
            "url",
            "uri",
            "username",
            "password",
            "verificationcode",
            "captcha",
            "cookie",
            "cookies",
            "token",
            "header",
            "headers",
            "secret",
            "secretstore",
            "secretreference",
            "storagestate",
            "localstorage",
            "sessionstorage",
            "credential",
            "credentials");
    private static final List<String> FORBIDDEN_SOURCE_MARKERS = List.of(
            "ProcessBuilder",
            "ProcessHandle",
            "java.net.",
            "InetAddress",
            "getByName(",
            "java.nio.file",
            "SocketChannel",
            "ServerSocket",
            "HttpClient",
            "RestClient",
            "RestTemplate",
            "WebClient",
            "Playwright",
            "Selenium",
            "SecretStorePort",
            "SecretReference",
            "DataSource",
            "DriverManager");

    @Test
    void protocolVocabularyHasOnlyOfflineAndAuthRequiredSemantics() {
        assertEquals(
                List.of("OFFLINE_REHEARSAL"),
                java.util.Arrays.stream(
                                ManualAuthorizationRehearsalMode.values())
                        .map(Enum::name)
                        .toList());
        assertEquals(
                List.of("AUTH_REQUIRED"),
                java.util.Arrays.stream(ManualAuthorizationState.values())
                        .map(Enum::name)
                        .toList());
        assertEquals(
                List.of("READY_FOR_OPERATOR_REHEARSAL"),
                java.util.Arrays.stream(
                                ManualAuthorizationPreparationStatus.values())
                        .map(Enum::name)
                        .toList());
    }

    @Test
    void publicDtosExposeNoCredentialNetworkOrBrowserMaterialField() {
        for (var dtoType : DTO_TYPES) {
            assertTrue(dtoType.isRecord(), dtoType + " must be an immutable record");
            for (RecordComponent component : dtoType.getRecordComponents()) {
                var normalizedName = component.getName()
                        .replace("_", "")
                        .toLowerCase(Locale.ROOT);
                assertFalse(
                        FORBIDDEN_COMPONENT_NAMES.stream()
                                .anyMatch(normalizedName::contains),
                        dtoType + " contains forbidden field " + component.getName());
                assertFalse(
                        component.getType().isArray(),
                        dtoType + " must not carry an arbitrary byte/character array");
                assertFalse(
                        Map.class.isAssignableFrom(component.getType()),
                        dtoType + " must not carry an arbitrary property map");
                assertFalse(
                        component.getType().getName().equals("java.net.URI")
                                || component.getType().getName()
                                        .equals("java.net.URL"),
                        dtoType + " must not carry an address");
            }
        }
    }

    @Test
    void rehearsalSourcesContainNoProcessIoNetworkBrowserDnsOrSecretStore()
            throws IOException {
        var sourceRoot = Path.of(
                "src",
                "main",
                "java",
                "cn",
                "sifangguan",
                "ota",
                "browsersession",
                "rehearsal");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths
                    .filter(path -> path.toString().endsWith(".java"))
                    .toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                for (var marker : FORBIDDEN_SOURCE_MARKERS) {
                    assertFalse(
                            source.contains(marker),
                            file + " contains forbidden marker " + marker);
                }
            }
        }
    }

    @Test
    void errorMessagesAreFixedSanitizedCodes() {
        for (var errorCode : ManualAuthorizationRehearsalErrorCode.values()) {
            assertTrue(errorCode.code().matches("[A-Z0-9_]+"));
            assertEquals(
                    errorCode.code(),
                    new ManualAuthorizationRehearsalPolicyException(errorCode)
                            .getMessage());
        }
    }
}
