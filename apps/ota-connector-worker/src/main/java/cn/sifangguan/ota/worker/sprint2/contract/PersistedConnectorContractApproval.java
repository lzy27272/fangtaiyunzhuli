package cn.sifangguan.ota.worker.sprint2.contract;

import java.util.Locale;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * Secret-free projection of an administrator-approved connector contract.
 */
public record PersistedConnectorContractApproval(
        String connectorCode,
        String adapterVersion,
        String fingerprintAlgorithm,
        String capabilityFingerprint,
        String schemaFingerprint,
        String approvalStatus,
        String connectorVersionStatus) {
    public static final String SUPPORTED_FINGERPRINT_ALGORITHM = "SHA-256-V1";
    public static final String APPROVED = "APPROVED";
    public static final String ACTIVE = "ACTIVE";
    private static final Pattern SHA_256 = Pattern.compile("[0-9a-f]{64}");

    public PersistedConnectorContractApproval {
        connectorCode = requireText(connectorCode, "connectorCode");
        adapterVersion = requireText(adapterVersion, "adapterVersion");
        fingerprintAlgorithm = normalizedCode(
                fingerprintAlgorithm,
                "fingerprintAlgorithm");
        capabilityFingerprint = normalizedFingerprint(
                capabilityFingerprint,
                "capabilityFingerprint");
        schemaFingerprint = normalizedFingerprint(
                schemaFingerprint,
                "schemaFingerprint");
        approvalStatus = normalizedCode(approvalStatus, "approvalStatus");
        connectorVersionStatus = normalizedCode(
                connectorVersionStatus,
                "connectorVersionStatus");
    }

    public boolean isApprovedAndActive() {
        return APPROVED.equals(approvalStatus)
                && ACTIVE.equals(connectorVersionStatus);
    }

    public ConnectorContractBaseline asContractBaseline() {
        return new ConnectorContractBaseline(
                connectorCode,
                adapterVersion,
                capabilityFingerprint,
                schemaFingerprint);
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    private static String normalizedCode(String value, String field) {
        return requireText(value, field).toUpperCase(Locale.ROOT);
    }

    private static String normalizedFingerprint(String value, String field) {
        var normalized = requireText(value, field).toLowerCase(Locale.ROOT);
        if (!SHA_256.matcher(normalized).matches()) {
            throw new IllegalArgumentException(
                    field + " must be a SHA-256 fingerprint");
        }
        return normalized;
    }
}
