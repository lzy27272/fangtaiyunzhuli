package cn.sifangguan.ota.contracts.port;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ScopedSecretStorePortTest {
    @Test
    void requiresAWorkBoundShortLeaseAndRedactsEveryReference() {
        var reference = new SecretStorePort.SecretReference(
                UUID.randomUUID(),
                UUID.randomUUID(),
                UUID.randomUUID(),
                "PMS_READ",
                "secretstore://offline-fixture/reference-one");
        var now = Instant.parse("2026-08-11T00:00:00Z");
        var request = new ScopedSecretStorePort.SecretAccessRequest(
                reference,
                UUID.randomUUID(),
                UUID.randomUUID(),
                "COLLECT_PMS_READ",
                now,
                now.plusSeconds(120));

        assertFalse(reference.toString().contains(reference.opaqueRef()));
        assertFalse(request.toString().contains(reference.opaqueRef()));
        assertFalse(request.toString().contains(request.servicePrincipalId().toString()));
    }

    @Test
    void rejectsExpiredOrOverlongOrUncontrolledLeases() {
        var reference = new SecretStorePort.SecretReference(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "PMS_READ", "secretstore://offline-fixture/reference-two");
        var now = Instant.parse("2026-08-11T00:00:00Z");

        assertThrows(IllegalArgumentException.class, () -> request(
                reference, "COLLECT_PMS_READ", now, now));
        assertThrows(IllegalArgumentException.class, () -> request(
                reference, "COLLECT_PMS_READ", now, now.plusSeconds(301)));
        assertThrows(IllegalArgumentException.class, () -> request(
                reference, "collect-pms", now, now.plusSeconds(60)));
    }

    @Test
    void scopedPortFailsClosedForLegacyUnscopedAccess() {
        ScopedSecretStorePort port = request -> {
            throw new AssertionError("scoped adapter should not be called by this test");
        };
        var reference = new SecretStorePort.SecretReference(
                UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                "PMS_READ", "secretstore://offline-fixture/reference-three");

        assertThrows(SecurityException.class, () -> port.open(reference));
    }

    private static ScopedSecretStorePort.SecretAccessRequest request(
            SecretStorePort.SecretReference reference,
            String operation,
            Instant requestedAt,
            Instant expiresAt
    ) {
        return new ScopedSecretStorePort.SecretAccessRequest(
                reference,
                UUID.randomUUID(),
                UUID.randomUUID(),
                operation,
                requestedAt,
                expiresAt);
    }
}
