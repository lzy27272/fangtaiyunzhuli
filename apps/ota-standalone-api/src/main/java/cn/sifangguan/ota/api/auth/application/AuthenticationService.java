package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountWithCredential;
import cn.sifangguan.ota.api.auth.domain.AuthSession;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.port.AccountRepository;
import cn.sifangguan.ota.api.auth.port.AuthSessionRepository;
import cn.sifangguan.ota.api.auth.port.LoginAttemptLimiter;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.transaction.annotation.Transactional;

public class AuthenticationService {
    private final AccountRepository accounts;
    private final AuthSessionRepository sessions;
    private final AuditPort audit;
    private final PasswordHasher passwordHasher;
    private final AccessTokenService accessTokens;
    private final RefreshTokenCodec refreshTokens;
    private final LoginAttemptLimiter loginLimiter;
    private final Clock clock;
    private final Duration refreshTtl;
    private final String dummyPasswordHash;

    public AuthenticationService(
            AccountRepository accounts,
            AuthSessionRepository sessions,
            AuditPort audit,
            PasswordHasher passwordHasher,
            AccessTokenService accessTokens,
            RefreshTokenCodec refreshTokens,
            LoginAttemptLimiter loginLimiter,
            Clock clock,
            Duration refreshTtl
    ) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.audit = audit;
        this.passwordHasher = passwordHasher;
        this.accessTokens = accessTokens;
        this.refreshTokens = refreshTokens;
        this.loginLimiter = loginLimiter;
        this.clock = clock;
        if (refreshTtl == null || refreshTtl.compareTo(Duration.ofHours(1)) < 0
                || refreshTtl.compareTo(Duration.ofDays(1)) > 0) {
            throw new IllegalArgumentException("Refresh TTL must be between 1 hour and 1 day");
        }
        this.refreshTtl = refreshTtl;
        char[] dummy = UUID.randomUUID().toString().toCharArray();
        try {
            this.dummyPasswordHash = passwordHasher.hash(dummy);
        } finally {
            Arrays.fill(dummy, '\0');
        }
    }

    @Transactional(noRollbackFor = {AuthenticationRejectedException.class, LoginRateLimitedException.class})
    public IssuedSession login(
            String username,
            char[] password,
            String sourceAddress,
            String correlationId
    ) {
        Instant now = clock.instant();
        String canonicalUsername = canonicalUsername(username);
        try {
            LoginAttemptLimiter.Decision rateLimit = loginLimiter.acquire(canonicalUsername, sourceAddress, now);
            if (!rateLimit.allowed()) {
                audit("AUTH_LOGIN_RATE_LIMITED", null, "DENIED", "LOGIN_RATE_LIMITED", correlationId, now);
                throw new LoginRateLimitedException(rateLimit.retryAfterSeconds());
            }
            Optional<AccountWithCredential> located = accounts.findForLogin(canonicalUsername);
            String expectedHash = located.map(value -> value.credential().passwordHash()).orElse(dummyPasswordHash);
            boolean passwordMatches = passwordHasher.matches(password, expectedHash);
            if (located.isEmpty()) {
                audit("AUTH_LOGIN", null, "DENIED", "INVALID_CREDENTIALS", correlationId, now);
                throw new AuthenticationRejectedException();
            }
            AccountWithCredential candidate = located.orElseThrow();
            if (!candidate.account().isActive() || candidate.credential().isLockedAt(now) || !passwordMatches) {
                if (!passwordMatches && candidate.account().isActive() && !candidate.credential().isLockedAt(now)) {
                    accounts.recordLoginFailure(candidate.account().id(), now);
                }
                audit("AUTH_LOGIN", candidate.account().id(), "DENIED", "INVALID_CREDENTIALS", correlationId, now);
                throw new AuthenticationRejectedException();
            }
            accounts.recordLoginSuccess(candidate.account().id());
            IssuedSession issued = createInitialSession(candidate.account(), now);
            audit("AUTH_LOGIN", candidate.account().id(), "SUCCEEDED", null, correlationId, now);
            return issued;
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    @Transactional(noRollbackFor = AuthenticationRejectedException.class)
    public IssuedSession refresh(String rawRefreshToken, String correlationId) {
        Instant now = clock.instant();
        String tokenHash = refreshTokens.digest(requireToken(rawRefreshToken));
        AuthSession current = sessions.findByTokenHash(tokenHash).orElseGet(() -> {
            audit("AUTH_REFRESH", null, "DENIED", "INVALID_REFRESH_TOKEN", correlationId, now);
            throw new AuthenticationRejectedException();
        });
        if (current.isConsumedOrRevoked()) {
            sessions.revokeFamily(current.familyId(), now, "REFRESH_REUSE_DETECTED");
            audit("AUTH_REFRESH_REUSE", current.accountId(), "DENIED", "REFRESH_REUSE_DETECTED", correlationId, now);
            throw new RefreshReuseDetectedException();
        }
        if (current.isExpiredAt(now)) {
            sessions.revokeFamily(current.familyId(), now, "REFRESH_EXPIRED");
            audit("AUTH_REFRESH", current.accountId(), "DENIED", "REFRESH_EXPIRED", correlationId, now);
            throw new AuthenticationRejectedException();
        }
        LocalAccount account = accounts.findById(current.accountId())
                .filter(LocalAccount::isActive)
                .filter(value -> value.authzVersion() == current.accountAuthzVersion())
                .orElseGet(() -> {
                    sessions.revokeFamily(current.familyId(), now, "ACCOUNT_OR_AUTHORIZATION_CHANGED");
                    audit("AUTH_REFRESH", current.accountId(), "DENIED",
                            "ACCOUNT_OR_AUTHORIZATION_CHANGED", correlationId, now);
                    throw new AuthenticationRejectedException();
                });

        String replacementRaw = refreshTokens.generate();
        AuthSession replacement = new AuthSession(
                UUID.randomUUID(),
                current.familyId(),
                account.id(),
                refreshTokens.digest(replacementRaw),
                account.authzVersion(),
                now,
                current.expiresAt(),
                null,
                null,
                null,
                null);
        AuthSessionRepository.RotationResult result = sessions.rotate(tokenHash, replacement, now);
        if (result != AuthSessionRepository.RotationResult.ROTATED) {
            sessions.revokeFamily(current.familyId(), now, "REFRESH_REUSE_DETECTED");
            audit("AUTH_REFRESH_REUSE", current.accountId(), "DENIED", "REFRESH_REUSE_DETECTED", correlationId, now);
            throw new RefreshReuseDetectedException();
        }
        IssuedAccessToken access = accessTokens.issue(account, replacement.id());
        audit("AUTH_REFRESH", account.id(), "SUCCEEDED", null, correlationId, now);
        return new IssuedSession(
                access.value(), access.expiresAt(), replacementRaw, replacement.expiresAt(),
                refreshTokens.generate(), AccountView.from(account));
    }

    @Transactional
    public void logout(String rawRefreshToken, String correlationId) {
        Instant now = clock.instant();
        sessions.findByTokenHash(refreshTokens.digest(requireToken(rawRefreshToken))).ifPresent(session -> {
            sessions.revokeFamily(session.familyId(), now, "USER_LOGOUT");
            audit("AUTH_LOGOUT", session.accountId(), "SUCCEEDED", null, correlationId, now);
        });
    }

    @Transactional(readOnly = true)
    public AuthenticatedAccount authenticateAccessToken(String rawAccessToken) {
        AccessTokenClaims claims = accessTokens.verify(rawAccessToken);
        AuthSession session = sessions.findById(claims.sessionId())
                .filter(value -> !value.isConsumedOrRevoked())
                .filter(value -> !value.isExpiredAt(clock.instant()))
                .filter(value -> value.accountId().equals(claims.accountId()))
                .orElseThrow(InvalidAccessTokenException::new);
        LocalAccount account = accounts.findById(claims.accountId())
                .filter(LocalAccount::isActive)
                .filter(value -> value.authzVersion() == claims.authzVersion())
                .filter(value -> value.authzVersion() == session.accountAuthzVersion())
                .orElseThrow(InvalidAccessTokenException::new);
        return new AuthenticatedAccount(account, session.id());
    }

    @Transactional
    public void revokeAllSessions(UUID accountId, String reason, String correlationId) {
        Instant now = clock.instant();
        sessions.revokeAllForAccount(accountId, now, reason);
        audit("AUTH_ALL_SESSIONS_REVOKED", accountId, "SUCCEEDED", reason, correlationId, now);
    }

    private IssuedSession createInitialSession(LocalAccount account, Instant now) {
        String refreshRaw = refreshTokens.generate();
        UUID sessionId = UUID.randomUUID();
        AuthSession session = new AuthSession(
                sessionId,
                UUID.randomUUID(),
                account.id(),
                refreshTokens.digest(refreshRaw),
                account.authzVersion(),
                now,
                now.plus(refreshTtl),
                null,
                null,
                null,
                null);
        sessions.create(session);
        IssuedAccessToken access = accessTokens.issue(account, sessionId);
        return new IssuedSession(
                access.value(), access.expiresAt(), refreshRaw, session.expiresAt(),
                refreshTokens.generate(), AccountView.from(account));
    }

    private void audit(
            String type,
            UUID accountId,
            String outcome,
            String reason,
            String correlationId,
            Instant occurredAt
    ) {
        audit.appendInCurrentTransaction(new AuditEvent(
                UUID.randomUUID(), type, accountId, outcome, reason, correlationId, occurredAt));
    }

    private static String canonicalUsername(String username) {
        if (username == null) {
            return "";
        }
        return username.strip().toLowerCase(Locale.ROOT);
    }

    private static String requireToken(String token) {
        if (token == null || token.isBlank() || token.length() > 512) {
            throw new AuthenticationRejectedException();
        }
        return token;
    }
}
