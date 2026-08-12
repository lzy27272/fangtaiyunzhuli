package cn.sifangguan.ota.contracts.gateway;

import java.util.Objects;
import java.util.regex.Pattern;

public record GatewayRequestMetadata(
        String idempotencyKey,
        String correlationId,
        long expectedVersion,
        String requestHash
) {
    private static final Pattern SAFE_KEY = Pattern.compile("[A-Za-z0-9._:-]{8,200}");
    private static final Pattern SAFE_CORRELATION = Pattern.compile("[^\\p{Cntrl}\\s]{1,200}");
    private static final Pattern SHA_256 = Pattern.compile("[a-f0-9]{64}");

    public GatewayRequestMetadata {
        idempotencyKey = requireMatch(idempotencyKey, SAFE_KEY, "idempotencyKey");
        correlationId = requireMatch(correlationId, SAFE_CORRELATION, "correlationId");
        if (expectedVersion < 0) {
            throw new IllegalArgumentException("expectedVersion must not be negative");
        }
        requestHash = requireMatch(requestHash, SHA_256, "requestHash");
    }

    private static String requireMatch(String value, Pattern pattern, String field) {
        Objects.requireNonNull(value, field);
        if (!pattern.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " is invalid");
        }
        return value;
    }

    @Override
    public String toString() {
        return "GatewayRequestMetadata[idempotencyKey=<redacted>, correlationId=<redacted>, "
                + "expectedVersion=" + expectedVersion + ", requestHash=<redacted>]";
    }
}
