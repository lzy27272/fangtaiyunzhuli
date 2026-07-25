package cn.sifangguan.ota.api.auth.adapter;

import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

class BoundedLoginAttemptLimiterTest {
    @Test
    void limitsAccountAndSourceIndependentlyAndResetsAfterWindow() {
        Instant now = Instant.parse("2026-07-23T00:00:00Z");
        BoundedLoginAttemptLimiter limiter = new BoundedLoginAttemptLimiter(
                100, 2, 3, Duration.ofMinutes(1));

        assertThat(limiter.acquire("admin", "10.0.0.1", now).allowed()).isTrue();
        assertThat(limiter.acquire("admin", "10.0.0.1", now).allowed()).isTrue();
        assertThat(limiter.acquire("admin", "10.0.0.2", now).allowed()).isFalse();
        assertThat(limiter.acquire("admin", "10.0.0.2", now.plusSeconds(61)).allowed()).isTrue();
    }
}
