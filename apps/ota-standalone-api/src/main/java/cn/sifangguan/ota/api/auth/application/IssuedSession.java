package cn.sifangguan.ota.api.auth.application;

import java.time.Instant;

public record IssuedSession(
        String accessToken,
        Instant accessExpiresAt,
        String refreshToken,
        Instant refreshExpiresAt,
        String csrfToken,
        AccountView account
) {
}
