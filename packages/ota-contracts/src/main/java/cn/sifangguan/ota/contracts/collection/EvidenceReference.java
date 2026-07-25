package cn.sifangguan.ota.contracts.collection;

import java.util.Objects;

public record EvidenceReference(
        String referenceId,
        String sha256,
        String mediaType,
        long byteLength) {

    public EvidenceReference {
        referenceId = requireText(referenceId, "referenceId");
        sha256 = requireText(sha256, "sha256");
        mediaType = requireText(mediaType, "mediaType");
        if (byteLength < 0) {
            throw new IllegalArgumentException("byteLength must not be negative");
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
