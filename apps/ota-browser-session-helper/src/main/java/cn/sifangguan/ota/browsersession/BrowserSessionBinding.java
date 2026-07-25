package cn.sifangguan.ota.browsersession;

import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

public record BrowserSessionBinding(
        String tenantId,
        String hotelId,
        String connectorId,
        String connectorVersion,
        String configVersion,
        String actorId,
        UUID authorizationAttemptId) {

    private static final Pattern IDENTIFIER_PATTERN =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}");

    public BrowserSessionBinding {
        tenantId = requireIdentifier(tenantId);
        hotelId = requireIdentifier(hotelId);
        connectorId = requireIdentifier(connectorId);
        connectorVersion = requireIdentifier(connectorVersion);
        configVersion = requireIdentifier(configVersion);
        actorId = requireIdentifier(actorId);
        Objects.requireNonNull(authorizationAttemptId, "authorizationAttemptId");
    }

    private static String requireIdentifier(String value) {
        Objects.requireNonNull(value, "binding identifier");
        if (!value.equals(value.strip())
                || !IDENTIFIER_PATTERN.matcher(value).matches()) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_SESSION_SCOPE);
        }
        return value;
    }
}
