package cn.sifangguan.ota.api.auth.port;

import cn.sifangguan.ota.api.auth.domain.AuthSession;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface AuthSessionRepository {
    enum RotationResult {
        ROTATED,
        ALREADY_CONSUMED_OR_REVOKED,
        MISSING
    }

    void create(AuthSession session);

    Optional<AuthSession> findByTokenHash(String tokenHash);

    Optional<AuthSession> findById(UUID sessionId);

    RotationResult rotate(String currentTokenHash, AuthSession replacement, Instant rotatedAt);

    void revokeFamily(UUID familyId, Instant revokedAt, String reason);

    void revokeAllForAccount(UUID accountId, Instant revokedAt, String reason);
}
