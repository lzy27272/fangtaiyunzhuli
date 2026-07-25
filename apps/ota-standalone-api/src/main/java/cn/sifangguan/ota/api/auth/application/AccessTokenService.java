package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.LocalAccount;

import java.util.UUID;

public interface AccessTokenService {
    IssuedAccessToken issue(LocalAccount account, UUID sessionId);

    AccessTokenClaims verify(String token);
}
