package cn.sifangguan.ota.browsersession;

import java.util.Objects;
import java.util.regex.Pattern;

public record BrowserRequestContract(
        String contractId,
        String contractVersion,
        String canonicalRequestSha256) {

    private static final Pattern IDENTIFIER_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
    private static final Pattern SHA_256_PATTERN =
            Pattern.compile("[0-9a-f]{64}");

    public BrowserRequestContract {
        Objects.requireNonNull(contractId, "contractId");
        Objects.requireNonNull(contractVersion, "contractVersion");
        Objects.requireNonNull(canonicalRequestSha256, "canonicalRequestSha256");
        if (!IDENTIFIER_PATTERN.matcher(contractId).matches()
                || !IDENTIFIER_PATTERN.matcher(contractVersion).matches()
                || !SHA_256_PATTERN.matcher(canonicalRequestSha256).matches()) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT);
        }
    }
}
