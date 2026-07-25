package cn.sifangguan.ota.contracts.connector;

import java.util.Objects;

public record ValidationIssue(String code, String field, String sanitizedMessage) {
    public ValidationIssue {
        code = requireText(code, "code");
        field = Objects.requireNonNullElse(field, "");
        sanitizedMessage = requireText(sanitizedMessage, "sanitizedMessage");
    }

    private static String requireText(String value, String fieldName) {
        Objects.requireNonNull(value, fieldName);
        if (value.isBlank()) {
            throw new IllegalArgumentException(fieldName + " must not be blank");
        }
        return value;
    }
}
