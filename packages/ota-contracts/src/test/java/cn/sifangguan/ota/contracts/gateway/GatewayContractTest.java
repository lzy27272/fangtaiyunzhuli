package cn.sifangguan.ota.contracts.gateway;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;

class GatewayContractTest {
    @Test
    void validatesCommandMetadataAndRedactsIdentifiers() {
        var metadata = new GatewayRequestMetadata(
                "offline-command-0001",
                "offline-correlation-0001",
                3,
                "a".repeat(64));
        var scope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());

        assertFalse(metadata.toString().contains("offline-command-0001"));
        assertFalse(metadata.toString().contains("a".repeat(64)));
        assertFalse(scope.toString().contains(scope.tenantId().toString()));
        assertFalse(scope.toString().contains(scope.hotelId().toString()));
    }

    @Test
    void rejectsWeakIdempotencyAndInvalidVersionOrHash() {
        assertThrows(IllegalArgumentException.class, () -> new GatewayRequestMetadata(
                "short", "correlation", 0, "a".repeat(64)));
        assertThrows(IllegalArgumentException.class, () -> new GatewayRequestMetadata(
                "offline-command-0001", "correlation", -1, "a".repeat(64)));
        assertThrows(IllegalArgumentException.class, () -> new GatewayRequestMetadata(
                "offline-command-0001", "correlation", 0, "not-a-hash"));
    }
}
