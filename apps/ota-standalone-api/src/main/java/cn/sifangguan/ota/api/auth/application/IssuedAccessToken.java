package cn.sifangguan.ota.api.auth.application;

import java.time.Instant;

public record IssuedAccessToken(String value, Instant expiresAt) {
}
