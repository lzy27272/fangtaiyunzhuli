package cn.sifangguan.hotelaios.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class PilotAuthModels {
    private PilotAuthModels() {
    }

    public record LoginRequest(
            @NotNull UUID tenantId,
            @NotBlank String loginName,
            @NotBlank String password
    ) {
    }

    public record LoginResponse(
            String accessToken,
            String tokenType,
            OffsetDateTime expiresAt,
            UUID accountId,
            String displayName
    ) {
    }
}

