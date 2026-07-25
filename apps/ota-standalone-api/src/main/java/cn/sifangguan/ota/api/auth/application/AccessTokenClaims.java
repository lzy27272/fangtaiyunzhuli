package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.OtaRole;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

public record AccessTokenClaims(
        UUID accountId,
        UUID sessionId,
        long authzVersion,
        Set<OtaRole> roles,
        Instant issuedAt,
        Instant expiresAt,
        UUID tokenId
) {
    public AccessTokenClaims {
        roles = Set.copyOf(roles);
    }
}
