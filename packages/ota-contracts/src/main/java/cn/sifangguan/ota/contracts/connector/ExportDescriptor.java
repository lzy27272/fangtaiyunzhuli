package cn.sifangguan.ota.contracts.connector;

import java.util.Objects;
import java.util.Set;

public record ExportDescriptor(
        String parserCode,
        SourceSystem sourceSystem,
        String parserVersion,
        Set<String> supportedMediaTypes) {
    public ExportDescriptor {
        parserCode = requireText(parserCode, "parserCode");
        Objects.requireNonNull(sourceSystem, "sourceSystem");
        parserVersion = requireText(parserVersion, "parserVersion");
        supportedMediaTypes = Set.copyOf(Objects.requireNonNull(supportedMediaTypes, "supportedMediaTypes"));
        if (supportedMediaTypes.isEmpty()) {
            throw new IllegalArgumentException("supportedMediaTypes must not be empty");
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
