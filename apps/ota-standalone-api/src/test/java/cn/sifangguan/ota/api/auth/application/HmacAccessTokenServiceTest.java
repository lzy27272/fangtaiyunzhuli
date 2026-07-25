package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HmacAccessTokenServiceTest {
    private static final Instant NOW = Instant.parse("2026-07-23T00:00:00Z");

    @Test
    void issuesAndVerifiesShortTokenAndRejectsTampering() {
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 7);
        HmacAccessTokenService service = service(Clock.fixed(NOW, ZoneOffset.UTC), key);
        LocalAccount account = new LocalAccount(
                UUID.randomUUID(), "operator", "Operator", AccountStatus.ACTIVE, 4,
                Set.of(OtaRole.OTA_OPERATION_MANAGER));
        UUID sessionId = UUID.randomUUID();

        IssuedAccessToken issued = service.issue(account, sessionId);
        AccessTokenClaims claims = service.verify(issued.value());

        assertThat(claims.accountId()).isEqualTo(account.id());
        assertThat(claims.sessionId()).isEqualTo(sessionId);
        assertThat(claims.authzVersion()).isEqualTo(4);
        assertThat(Duration.between(NOW, issued.expiresAt())).isEqualTo(Duration.ofMinutes(10));
        int payloadStart = issued.value().indexOf('.') + 1;
        char original = issued.value().charAt(payloadStart);
        String tampered = issued.value().substring(0, payloadStart)
                + (original == 'A' ? 'B' : 'A')
                + issued.value().substring(payloadStart + 1);
        assertThatThrownBy(() -> service.verify(tampered)).isInstanceOf(InvalidAccessTokenException.class);
    }

    @Test
    void rejectsExpiredToken() {
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 9);
        HmacAccessTokenService issuer = service(Clock.fixed(NOW, ZoneOffset.UTC), key);
        LocalAccount account = new LocalAccount(
                UUID.randomUUID(), "operator", "Operator", AccountStatus.ACTIVE, 1,
                Set.of(OtaRole.CEO));
        String token = issuer.issue(account, UUID.randomUUID()).value();
        HmacAccessTokenService verifier = service(
                Clock.fixed(NOW.plus(Duration.ofMinutes(11)), ZoneOffset.UTC), key);

        assertThatThrownBy(() -> verifier.verify(token)).isInstanceOf(InvalidAccessTokenException.class);
    }

    private static HmacAccessTokenService service(Clock clock, byte[] key) {
        return new HmacAccessTokenService(
                new ObjectMapper(), clock, "issuer", Duration.ofMinutes(10), "current",
                Map.of("current", new HmacAccessTokenService.SigningKey(key, Instant.MAX)));
    }
}
