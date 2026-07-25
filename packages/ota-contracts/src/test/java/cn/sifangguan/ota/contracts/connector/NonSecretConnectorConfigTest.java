package cn.sifangguan.ota.contracts.connector;

import org.junit.jupiter.api.Test;

import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NonSecretConnectorConfigTest {
    @Test
    void keepsOnlyAnImmutableNonSecretConfigurationMap() {
        var config = new NonSecretConnectorConfig(
                UUID.randomUUID(),
                3,
                policy(),
                Map.of("baseUrl", "https://pms.example.test", "hotelCode", "pilot-1"));

        assertEquals("pilot-1", config.values().get("hotelCode"));
        assertThrows(UnsupportedOperationException.class, () -> config.values().put("x", "y"));
    }

    @Test
    void rejectsFieldsOutsideTheTrustedAdapterPolicy() {
        assertThrows(IllegalArgumentException.class, () -> new NonSecretConnectorConfig(
                UUID.randomUUID(),
                1,
                policy(),
                Map.of("notes", "unclassified values are forbidden")));
    }

    @Test
    void rejectsAuthorizationAndHeaderFieldsEvenWhenAProposedPolicyAllowsThem() {
        assertThrows(IllegalArgumentException.class, () -> new NonSecretConnectorConfig(
                UUID.randomUUID(), 1,
                new ConnectorConfigFieldPolicy(
                        "unsafe.authorization.v1", Set.of("authorization"), Map.of()),
                Map.of("authorization", "must-never-enter-this-dto")));
        assertThrows(IllegalArgumentException.class, () -> new NonSecretConnectorConfig(
                UUID.randomUUID(), 1,
                new ConnectorConfigFieldPolicy(
                        "unsafe.headers.v1", Set.of("requestHeaders"), Map.of()),
                Map.of("requestHeaders", "must-never-enter-this-dto")));
    }

    @Test
    void rejectsUrlUserInfoFragmentsAndSensitiveOrUnlistedQueryParameters() {
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://user:password@pms.example.test/api"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://pms.example.test/api#access-token"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://pms.example.test/api?access%5Ftoken=secret"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://pms.example.test/api?redirect=unapproved"));
    }

    @Test
    void rejectsUnlistedHostsIpLiteralsLocalhostAndHttpUnderTheDefaultPolicy() {
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://evil.example.test/api"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://169.254.169.254/latest/meta-data"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "https://localhost/admin"));
        assertThrows(IllegalArgumentException.class, () -> config(
                "http://pms.example.test/api"));
        assertThrows(IllegalArgumentException.class, () ->
                ConnectorConfigFieldPolicy.UrlFieldPolicy.httpsOnly(
                        Set.of("127.0.0.1"), Set.of()));
        assertThrows(IllegalArgumentException.class, () ->
                ConnectorConfigFieldPolicy.UrlFieldPolicy.httpsOnly(
                        Set.of("0x7f.0.0.1"), Set.of()));
    }

    @Test
    void permitsReviewedInternalHttpOnlyWhenThePolicyDeclaresItExplicitly() {
        var policy = new ConnectorConfigFieldPolicy(
                "pms.reviewed-intranet.v1",
                Set.of("hotelCode"),
                Map.of("baseUrl", new ConnectorConfigFieldPolicy.UrlFieldPolicy(
                        Set.of("http"), Set.of("pms.intranet.example"), Set.of())));

        var config = new NonSecretConnectorConfig(
                UUID.randomUUID(),
                1,
                policy,
                Map.of("baseUrl", "http://pms.intranet.example/api", "hotelCode", "pilot-1"));

        assertEquals("http://pms.intranet.example/api", config.values().get("baseUrl"));
    }

    @Test
    void acceptsOnlyExplicitlyAllowedNonSecretUrlQueryParameters() {
        var config = config("https://pms.example.test/api?locale=zh-CN");

        assertEquals("https://pms.example.test/api?locale=zh-CN", config.values().get("baseUrl"));
    }

    private static NonSecretConnectorConfig config(String baseUrl) {
        return new NonSecretConnectorConfig(
                UUID.randomUUID(),
                1,
                policy(),
                Map.of("baseUrl", baseUrl, "hotelCode", "pilot-1"));
    }

    private static ConnectorConfigFieldPolicy policy() {
        return new ConnectorConfigFieldPolicy(
                "pms.basic.v1",
                Set.of("hotelCode"),
                Map.of("baseUrl", ConnectorConfigFieldPolicy.UrlFieldPolicy.httpsOnly(
                        Set.of("pms.example.test"), Set.of("locale"))));
    }
}
