package cn.sifangguan.ota.contracts.port;

import java.util.Objects;
import java.util.UUID;

/**
 * Boundary for resolving secret material. Secret values are deliberately absent from every DTO;
 * callers can use material only inside a short-lived lease callback.
 */
public interface SecretStorePort {
    SecretLease open(SecretReference reference);

    record SecretReference(UUID tenantId, UUID hotelId, UUID connectorId, String purpose, String opaqueRef) {
        public SecretReference {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            purpose = requireText(purpose, "purpose");
            opaqueRef = requireText(opaqueRef, "opaqueRef");
        }

        @Override
        public String toString() {
            return "SecretReference[scope=<redacted>, purpose=" + purpose + ", opaqueRef=<redacted>]";
        }
    }

    interface SecretLease extends AutoCloseable {
        void use(SecretMaterialConsumer consumer);

        @Override
        void close();
    }

    @FunctionalInterface
    interface SecretMaterialConsumer {
        void accept(char[] material);
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
