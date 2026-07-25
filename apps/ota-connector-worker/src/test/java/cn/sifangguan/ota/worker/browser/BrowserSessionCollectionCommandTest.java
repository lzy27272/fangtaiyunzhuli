package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.port.SecretStorePort.SecretReference;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BrowserSessionCollectionCommandTest {
    private static final UUID ACTOR_ACCOUNT_ID = UUID.fromString(
            "81a84ed0-2325-46eb-bc6c-892acec2f7dd");
    private static final UUID AUTHORIZATION_ATTEMPT_ID = UUID.fromString(
            "208df9ec-cf4d-4d05-a467-7d90ab982d13");
    private static final UUID CONNECTOR_VERSION_ID = UUID.fromString(
            "6404f9e6-1f56-4f67-939a-2312b8fe79b3");

    @Test
    void acceptsOnlyAnOpaqueScopedBrowserSessionReference() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "oskeyring://ota/uat/hotel/connector/browser-session");

        assertDoesNotThrow(() -> new BrowserSessionCollectionCommand(
                request,
                ACTOR_ACCOUNT_ID,
                AUTHORIZATION_ATTEMPT_ID,
                CONNECTOR_VERSION_ID,
                "BYH_PMS_BROWSER",
                "1.0.0",
                reference,
                1,
                "OSKEYRING",
                "READ_PMS_BUSINESS_DATE",
                request.cutoffAt().plusSeconds(30)));
    }

    @Test
    void rejectsCookieHeaderMaterialInsteadOfTreatingItAsAReference() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "session=value; another=value");

        assertThrows(
                IllegalArgumentException.class,
                () -> new BrowserSessionCollectionCommand(
                        request,
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        reference,
                        1,
                        "OSKEYRING",
                        "READ_PMS_BUSINESS_DATE",
                        request.cutoffAt().plusSeconds(30)));
    }

    @Test
    void rejectsAReferenceFromAnotherHotel() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                java.util.UUID.randomUUID(),
                request.connectorId(),
                "BROWSER_SESSION",
                "vault://ota/uat/hotel/connector/browser-session");

        assertThrows(
                IllegalArgumentException.class,
                () -> new BrowserSessionCollectionCommand(
                        request,
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        reference,
                        1,
                        "VAULT",
                        "READ_PMS_BUSINESS_DATE",
                        request.cutoffAt().plusSeconds(30)));
    }

    @Test
    void disabledClientFailsWithASanitizedFixedReason() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "secretstore://ota/uat/hotel/connector/browser-session");
        var command = new BrowserSessionCollectionCommand(
                request,
                ACTOR_ACCOUNT_ID,
                AUTHORIZATION_ATTEMPT_ID,
                CONNECTOR_VERSION_ID,
                "BYH_PMS_BROWSER",
                "1.0.0",
                reference,
                1,
                "SECRETSTORE",
                "READ_PMS_BUSINESS_DATE",
                request.cutoffAt().plusSeconds(30));
        var manifest = BrowserOperationAdmissionManifest.load(() -> List.of(
                new BrowserOperationAdmissionManifest.Entry(
                        request.scope().tenantId(),
                        request.scope().hotelId(),
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        request.connectorId(),
                        request.configVersion(),
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        request.stream(),
                        "SECRETSTORE",
                        "READ_PMS_BUSINESS_DATE",
                        reference.opaqueRef(),
                        1)));
        var admitted = new BrowserOperationAdmissionGuard(manifest).admit(command);

        var failure = assertThrows(
                BrowserSessionHelperUnavailableException.class,
                () -> new DisabledIsolatedBrowserConnectorClient().collect(admitted));

        assertEquals("BROWSER_SESSION_HELPER_NOT_ENABLED", failure.reasonCode());
    }

    @Test
    void rejectsSecretProviderThatDoesNotExactlyMatchTheLocatorScheme() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "oskeyring://ota/uat/hotel/connector/browser-session");

        assertThrows(
                IllegalArgumentException.class,
                () -> new BrowserSessionCollectionCommand(
                        request,
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        reference,
                        1,
                        "VAULT",
                        "READ_PMS_BUSINESS_DATE",
                        request.cutoffAt().plusSeconds(30)));
        assertThrows(
                IllegalArgumentException.class,
                () -> new BrowserSessionCollectionCommand(
                        request,
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        reference,
                        1,
                        "BYH_PMS",
                        "READ_PMS_BUSINESS_DATE",
                        request.cutoffAt().plusSeconds(30)));
    }

    @Test
    void toStringRedactsScopeAuthorizationAndTheEntireSecretReference() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "oskeyring://ota/uat/hotel/connector/browser-session");
        var command = new BrowserSessionCollectionCommand(
                request,
                ACTOR_ACCOUNT_ID,
                AUTHORIZATION_ATTEMPT_ID,
                CONNECTOR_VERSION_ID,
                "BYH_PMS_BROWSER",
                "1.0.0",
                reference,
                3,
                "OSKEYRING",
                "READ_PMS_BUSINESS_DATE",
                request.cutoffAt().plusSeconds(30));

        var rendered = command.toString();

        assertTrue(rendered.contains("scope=<redacted>"));
        assertTrue(rendered.contains("connectorCode=BYH_PMS_BROWSER"));
        assertTrue(rendered.contains("secretProviderCode=OSKEYRING"));
        assertFalse(rendered.contains(reference.opaqueRef()));
        assertFalse(rendered.contains(reference.toString()));
        assertFalse(rendered.contains(request.scope().tenantId().toString()));
        assertFalse(rendered.contains(request.scope().hotelId().toString()));
        assertFalse(rendered.contains(ACTOR_ACCOUNT_ID.toString()));
        assertFalse(rendered.contains(AUTHORIZATION_ATTEMPT_ID.toString()));
    }

    @Test
    void invalidLocatorExceptionDoesNotEchoOrRetainTheLocator() {
        var request = CollectionFixtures.request();
        var malformedLocator = "oskeyring://ota/uat/%not-valid";
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                malformedLocator);

        var failure = assertThrows(
                IllegalArgumentException.class,
                () -> new BrowserSessionCollectionCommand(
                        request,
                        ACTOR_ACCOUNT_ID,
                        AUTHORIZATION_ATTEMPT_ID,
                        CONNECTOR_VERSION_ID,
                        "BYH_PMS_BROWSER",
                        "1.0.0",
                        reference,
                        1,
                        "OSKEYRING",
                        "READ_PMS_BUSINESS_DATE",
                        request.cutoffAt().plusSeconds(30)));

        assertFalse(failure.getMessage().contains(malformedLocator));
        assertNull(failure.getCause());
    }
}
