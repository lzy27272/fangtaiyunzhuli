package cn.sifangguan.ota.contracts.common;

import java.util.Objects;

public record TraceContext(String traceId, String correlationId) {
    public TraceContext {
        traceId = requireText(traceId, "traceId");
        correlationId = requireText(correlationId, "correlationId");
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name);
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
