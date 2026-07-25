package cn.sifangguan.ota.api.audit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.UUID;

public final class CorrelationIdMapper {
    private static final byte[] NAMESPACE = "sifangguan-ota-correlation-v1:"
            .getBytes(StandardCharsets.US_ASCII);

    private CorrelationIdMapper() {
    }

    public static UUID toUuid(String externalCorrelationId) {
        if (externalCorrelationId == null || externalCorrelationId.isBlank()) {
            return UUID.randomUUID();
        }
        try {
            return UUID.fromString(externalCorrelationId);
        } catch (IllegalArgumentException ignored) {
            return sha256Uuid(externalCorrelationId);
        }
    }

    private static UUID sha256Uuid(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(NAMESPACE);
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            try {
                hash[6] = (byte) ((hash[6] & 0x0f) | 0x50);
                hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
                long most = 0;
                long least = 0;
                for (int index = 0; index < 8; index++) {
                    most = (most << 8) | (hash[index] & 0xffL);
                    least = (least << 8) | (hash[index + 8] & 0xffL);
                }
                return new UUID(most, least);
            } finally {
                Arrays.fill(hash, (byte) 0);
            }
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
