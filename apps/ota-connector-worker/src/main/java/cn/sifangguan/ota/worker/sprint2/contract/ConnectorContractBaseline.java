package cn.sifangguan.ota.worker.sprint2.contract;

import java.util.Objects;
import java.util.regex.Pattern;

public record ConnectorContractBaseline(
        String connectorCode,
        String adapterVersion,
        String capabilityFingerprint,
        String schemaFingerprint) {
    private static final Pattern SHA_256 = Pattern.compile("[0-9a-f]{64}");

    public ConnectorContractBaseline {
        connectorCode = requireText(connectorCode, "connectorCode");
        adapterVersion = requireText(adapterVersion, "adapterVersion");
        capabilityFingerprint = requireFingerprint(capabilityFingerprint, "capabilityFingerprint");
        schemaFingerprint = requireFingerprint(schemaFingerprint, "schemaFingerprint");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    private static String requireFingerprint(String value, String field) {
        Objects.requireNonNull(value, field);
        if (!SHA_256.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a lowercase SHA-256 fingerprint");
        }
        return value;
    }
}
