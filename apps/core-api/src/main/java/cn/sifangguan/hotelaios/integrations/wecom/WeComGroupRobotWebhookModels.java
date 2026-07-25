package cn.sifangguan.hotelaios.integrations.wecom;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

/** API contracts for the store-level WeCom group robot configuration. */
public final class WeComGroupRobotWebhookModels {
    private WeComGroupRobotWebhookModels() {
    }

    public record SaveWebhook(
            @NotBlank @Size(max = 2048) String webhookUrl
    ) {
    }

    /** Deliberately contains configuration state only; the Webhook URL is never returned. */
    public record StoreWebhookStatus(
            UUID hotelOrgUnitId,
            String hotelCode,
            String hotelName,
            boolean configured,
            OffsetDateTime updatedAt,
            String updatedByName,
            boolean secureStorageReady
    ) {
    }

    /** Deliberately contains no secret or secret-derived identifier. */
    public record SaveWebhookResult(
            UUID hotelOrgUnitId,
            boolean configured,
            OffsetDateTime updatedAt
    ) {
    }
}
