package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.authorization.OtaPermission;

import java.util.UUID;

public record UpsertHotelConfigurationCommand(
        UUID targetTenantId,
        UUID hotelId,
        String idempotencyKey,
        long expectedRowVersion,
        String changeReasonCode
) implements TenantConfigurationCommand {
    @Override
    public OtaPermission requiredPermission() {
        return OtaPermission.HOTEL_CONFIG_MANAGE;
    }
}
