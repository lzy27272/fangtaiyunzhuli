package cn.sifangguan.ota.api.auth.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AuthSession(
        UUID id,
        UUID familyId,
        UUID accountId,
        String refreshTokenHash,
        long accountAuthzVersion,
        Instant issuedAt,
        Instant expiresAt,
        Instant rotatedAt,
        UUID replacedBySessionId,
        Instant revokedAt,
        String revokedReason
) {
    public AuthSession {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(familyId, "familyId");
        Objects.requireNonNull(accountId, "accountId");
        if (refreshTokenHash == null || refreshTokenHash.isBlank()) {
            throw new IllegalArgumentException("refreshTokenHash must not be blank");
        }
        if (accountAuthzVersion < 1) {
            throw new IllegalArgumentException("accountAuthzVersion must be positive");
        }
        Objects.requireNonNull(issuedAt, "issuedAt");
        Objects.requireNonNull(expiresAt, "expiresAt");
    }

    public boolean isExpiredAt(Instant now) {
        return !now.isBefore(expiresAt);
    }

    public boolean isConsumedOrRevoked() {
        return rotatedAt != null || revokedAt != null;
    }
}
