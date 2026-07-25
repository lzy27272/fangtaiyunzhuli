package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.authorization.OtaPermission;

import java.util.UUID;

public record UpsertConnectorReferenceCommand(
        UUID targetTenantId,
        UUID hotelId,
        UUID connectorId,
        String idempotencyKey,
        long expectedRowVersion,
        String changeReasonCode
) implements TenantConfigurationCommand {
    @Override
    public OtaPermission requiredPermission() {
        return OtaPermission.CONNECTOR_CONFIG_MANAGE;
    }
}
