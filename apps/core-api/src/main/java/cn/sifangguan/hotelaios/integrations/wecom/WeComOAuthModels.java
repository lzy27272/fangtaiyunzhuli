package cn.sifangguan.hotelaios.integrations.wecom;

import jakarta.validation.constraints.NotBlank;

import java.time.OffsetDateTime;
import java.util.UUID;

public final class WeComOAuthModels {
    private WeComOAuthModels() { }

    public record ExchangeRequest(@NotBlank String exchangeCode) { }

    public record ExchangeResponse(
            String accessToken,
            String tokenType,
            OffsetDateTime expiresAt,
            UUID accountId,
            String displayName,
            String returnTo
    ) { }
}
