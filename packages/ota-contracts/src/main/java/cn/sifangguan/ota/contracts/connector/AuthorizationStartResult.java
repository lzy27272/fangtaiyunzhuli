package cn.sifangguan.ota.contracts.connector;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AuthorizationStartResult(
        UUID authorizationAttemptId,
        AuthorizationState state,
        Instant expiresAt,
        String interactionReference) {
    public AuthorizationStartResult {
        Objects.requireNonNull(authorizationAttemptId, "authorizationAttemptId");
        Objects.requireNonNull(state, "state");
        Objects.requireNonNull(expiresAt, "expiresAt");
        interactionReference = requireText(interactionReference, "interactionReference");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
