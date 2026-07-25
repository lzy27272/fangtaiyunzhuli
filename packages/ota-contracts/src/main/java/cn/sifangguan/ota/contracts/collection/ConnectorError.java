package cn.sifangguan.ota.contracts.collection;

import java.util.Objects;

public record ConnectorError(String code, boolean retryable, String sanitizedMessage) {
    public ConnectorError {
        code = requireText(code, "code");
        sanitizedMessage = requireText(sanitizedMessage, "sanitizedMessage");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
