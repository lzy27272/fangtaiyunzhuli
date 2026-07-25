package cn.sifangguan.ota.api.health;

import cn.sifangguan.ota.api.auth.application.AccessTokenService;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;

public final class SecurityMaterialHealthIndicator implements HealthIndicator {
    @SuppressWarnings("unused")
    private final AccessTokenService accessTokenService;

    public SecurityMaterialHealthIndicator(AccessTokenService accessTokenService) {
        this.accessTokenService = accessTokenService;
    }

    @Override
    public Health health() {
        return Health.up().withDetail("accessSigningMaterial", "loaded").build();
    }
}
