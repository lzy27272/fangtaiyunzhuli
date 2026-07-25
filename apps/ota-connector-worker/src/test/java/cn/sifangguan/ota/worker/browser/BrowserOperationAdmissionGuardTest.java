package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.port.SecretStorePort.SecretReference;
import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BrowserOperationAdmissionGuardTest {
    private static final UUID ACTOR_ACCOUNT_ID = UUID.fromString(
            "81a84ed0-2325-46eb-bc6c-892acec2f7dd");
    private static final UUID AUTHORIZATION_ATTEMPT_ID = UUID.fromString(
            "208df9ec-cf4d-4d05-a467-7d90ab982d13");
    private static final UUID CONNECTOR_VERSION_ID = UUID.fromString(
            "6404f9e6-1f56-4f67-939a-2312b8fe79b3");

    @Test
    void admitsOnlyTheExactCommandFromAnIndependentTrustedManifest() {
        var command = command();
        var manifest = trustedManifest(
                List.of(entryFor(command, Mismatch.NONE)));

        var admitted = new BrowserOperationAdmissionGuard(manifest).admit(command);

        assertSame(command, admitted.command());
    }

    @Test
    void rejectsEveryScopeVersionProviderOperationAndReferenceMismatch() {
        var command = command();
        for (var mismatch : Mismatch.values()) {
            if (mismatch == Mismatch.NONE) {
                continue;
            }
            var manifest = trustedManifest(
                    List.of(entryFor(command, mismatch)));
            var guard = new BrowserOperationAdmissionGuard(manifest);

            var failure = assertThrows(
                    BrowserOperationAdmissionException.class,
                    () -> guard.admit(command),
                    mismatch.name());

            assertEquals(
                    "BROWSER_OPERATION_NOT_ADMITTED",
                    failure.reasonCode(),
                    mismatch.name());
        }
    }

    @Test
    void emptyTrustedManifestFailsClosed() {
        var failure = assertThrows(
                BrowserOperationAdmissionException.class,
                () -> new BrowserOperationAdmissionGuard(
                        trustedManifest(List.of())).admit(command()));

        assertEquals("BROWSER_OPERATION_NOT_ADMITTED", failure.reasonCode());
    }

    @Test
    void admittedCapabilityCannotBeConstructedByAnUncheckedCaller() {
        assertTrue(Arrays.stream(
                        BrowserOperationAdmissionGuard.AdmittedCommand.class
                                .getDeclaredConstructors())
                .allMatch(constructor ->
                        Modifier.isPrivate(constructor.getModifiers())));
    }

    @Test
    void trustedManifestConstructionIsNotPubliclyBootstrappable() {
        assertTrue(Arrays.stream(
                        BrowserOperationAdmissionManifest.class
                                .getDeclaredConstructors())
                .allMatch(constructor ->
                        Modifier.isPrivate(constructor.getModifiers())));
        assertTrue(!Modifier.isPublic(
                BrowserOperationAdmissionManifest.Entry.class.getModifiers()));
        assertTrue(!Modifier.isPublic(
                BrowserOperationAdmissionManifest.TrustedManifestSource.class
                        .getModifiers()));
    }

    private static BrowserSessionCollectionCommand command() {
        var request = CollectionFixtures.request();
        var reference = new SecretReference(
                request.scope().tenantId(),
                request.scope().hotelId(),
                request.connectorId(),
                "BROWSER_SESSION",
                "oskeyring://ota/uat/hotel/connector/browser-session");
        return new BrowserSessionCollectionCommand(
                request,
                ACTOR_ACCOUNT_ID,
                AUTHORIZATION_ATTEMPT_ID,
                CONNECTOR_VERSION_ID,
                "BYH_PMS_BROWSER",
                "1.0.0",
                reference,
                7,
                "OSKEYRING",
                "READ_PMS_BUSINESS_DATE",
                request.cutoffAt().plusSeconds(30));
    }

    private static BrowserOperationAdmissionManifest.Entry entryFor(
            BrowserSessionCollectionCommand command,
            Mismatch mismatch) {
        var request = command.request();
        var reference = command.sessionReference();
        var tenantId = request.scope().tenantId();
        var hotelId = request.scope().hotelId();
        var actorAccountId = command.actorAccountId();
        var authorizationAttemptId = command.authorizationAttemptId();
        var connectorId = request.connectorId();
        var configVersion = request.configVersion();
        var connectorVersionId = command.connectorVersionId();
        var connectorCode = command.connectorCode();
        var adapterVersion = command.adapterVersion();
        var stream = request.stream();
        var secretProviderCode = command.secretProviderCode();
        var operationCode = command.approvedOperationCode();
        var opaqueReference = reference.opaqueRef();
        var secretBindingVersion = command.secretBindingVersion();

        switch (mismatch) {
            case NONE -> {
            }
            case TENANT -> tenantId = UUID.randomUUID();
            case HOTEL -> hotelId = UUID.randomUUID();
            case ACTOR_ACCOUNT -> actorAccountId = UUID.randomUUID();
            case AUTHORIZATION_ATTEMPT ->
                    authorizationAttemptId = UUID.randomUUID();
            case CONNECTOR -> connectorId = UUID.randomUUID();
            case CONFIG_VERSION -> configVersion++;
            case CONNECTOR_VERSION -> connectorVersionId = UUID.randomUUID();
            case CONNECTOR_CODE -> connectorCode = "OTHER_PMS_BROWSER";
            case ADAPTER_VERSION -> adapterVersion = "1.0.1";
            case STREAM -> stream = differentStream(stream);
            case PROVIDER -> {
                secretProviderCode = "VAULT";
                opaqueReference =
                        "vault://ota/uat/hotel/connector/browser-session";
            }
            case OPERATION -> operationCode = "READ_OTHER_RESOURCE";
            case SECRET_REFERENCE ->
                    opaqueReference =
                            "oskeyring://ota/uat/hotel/connector/other-session";
            case SECRET_BINDING_VERSION -> secretBindingVersion++;
        }

        return new BrowserOperationAdmissionManifest.Entry(
                tenantId,
                hotelId,
                actorAccountId,
                authorizationAttemptId,
                connectorId,
                configVersion,
                connectorVersionId,
                connectorCode,
                adapterVersion,
                stream,
                secretProviderCode,
                operationCode,
                opaqueReference,
                secretBindingVersion);
    }

    private static BrowserOperationAdmissionManifest trustedManifest(
            List<BrowserOperationAdmissionManifest.Entry> entries) {
        BrowserOperationAdmissionManifest.TrustedManifestSource fakeSource =
                () -> entries;
        return BrowserOperationAdmissionManifest.load(fakeSource);
    }

    private static DataStreamType differentStream(DataStreamType current) {
        return Arrays.stream(DataStreamType.values())
                .filter(candidate -> candidate != current)
                .findFirst()
                .orElseThrow();
    }

    private enum Mismatch {
        NONE,
        TENANT,
        HOTEL,
        ACTOR_ACCOUNT,
        AUTHORIZATION_ATTEMPT,
        CONNECTOR,
        CONFIG_VERSION,
        CONNECTOR_VERSION,
        CONNECTOR_CODE,
        ADAPTER_VERSION,
        STREAM,
        PROVIDER,
        OPERATION,
        SECRET_REFERENCE,
        SECRET_BINDING_VERSION
    }
}
