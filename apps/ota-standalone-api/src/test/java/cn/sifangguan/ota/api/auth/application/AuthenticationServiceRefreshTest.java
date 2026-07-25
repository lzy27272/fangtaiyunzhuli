package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.AuthSession;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.port.AccountRepository;
import cn.sifangguan.ota.api.auth.port.AuthSessionRepository;
import cn.sifangguan.ota.api.auth.port.LoginAttemptLimiter;
import org.junit.jupiter.api.Test;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AuthenticationServiceRefreshTest {
    @Test
    void rotatesRefreshAndRevokesWholeFamilyWhenOldTokenIsReused() {
        Instant now = Instant.parse("2026-07-23T00:00:00Z");
        Clock clock = Clock.fixed(now, ZoneOffset.UTC);
        RefreshTokenCodec codec = new RefreshTokenCodec(new SecureRandom());
        String raw = codec.generate();
        UUID familyId = UUID.randomUUID();
        UUID accountId = UUID.randomUUID();
        AuthSession current = new AuthSession(
                UUID.randomUUID(), familyId, accountId, codec.digest(raw), 2,
                now.minusSeconds(60), now.plusSeconds(3_600), null, null, null, null);
        AuthSession consumed = new AuthSession(
                current.id(), familyId, accountId, current.refreshTokenHash(), 2,
                current.issuedAt(), current.expiresAt(), now, UUID.randomUUID(), null, null);
        LocalAccount account = new LocalAccount(
                accountId, "operator", "Operator", AccountStatus.ACTIVE, 2,
                Set.of(OtaRole.OTA_OPERATION_MANAGER));

        AccountRepository accounts = mock(AccountRepository.class);
        AuthSessionRepository sessions = mock(AuthSessionRepository.class);
        AuditPort audit = mock(AuditPort.class);
        PasswordHasher passwordHasher = mock(PasswordHasher.class);
        AccessTokenService accessTokens = mock(AccessTokenService.class);
        LoginAttemptLimiter limiter = mock(LoginAttemptLimiter.class);
        when(passwordHasher.hash(any(char[].class))).thenReturn("dummy-hash");
        when(sessions.findByTokenHash(current.refreshTokenHash()))
                .thenReturn(Optional.of(current), Optional.of(consumed));
        when(accounts.findById(accountId)).thenReturn(Optional.of(account));
        when(sessions.rotate(anyString(), any(AuthSession.class), any(Instant.class)))
                .thenReturn(AuthSessionRepository.RotationResult.ROTATED);
        when(accessTokens.issue(any(LocalAccount.class), any(UUID.class)))
                .thenReturn(new IssuedAccessToken("access", now.plusSeconds(600)));
        AuthenticationService service = new AuthenticationService(
                accounts, sessions, audit, passwordHasher, accessTokens, codec, limiter, clock,
                Duration.ofHours(12));

        IssuedSession replacement = service.refresh(raw, "refresh-1");
        assertThat(replacement.refreshToken()).isNotEqualTo(raw);

        assertThatThrownBy(() -> service.refresh(raw, "refresh-reuse"))
                .isInstanceOf(RefreshReuseDetectedException.class);
        verify(sessions).revokeFamily(familyId, now, "REFRESH_REUSE_DETECTED");
    }
}
