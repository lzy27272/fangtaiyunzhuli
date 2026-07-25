package cn.sifangguan.ota.api.auth.domain;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AccountCredential(
        UUID accountId,
        String passwordHash,
        String algorithm,
        int failedAttempts,
        Instant lockedUntil
) {
    public AccountCredential {
        Objects.requireNonNull(accountId, "accountId");
        if (passwordHash == null || passwordHash.isBlank()) {
            throw new IllegalArgumentException("passwordHash must not be blank");
        }
        if (!"ARGON2ID".equals(algorithm)) {
            throw new IllegalArgumentException("Only ARGON2ID credentials are accepted");
        }
        if (failedAttempts < 0) {
            throw new IllegalArgumentException("failedAttempts must not be negative");
        }
    }

    public boolean isLockedAt(Instant now) {
        return lockedUntil != null && now.isBefore(lockedUntil);
    }
}
