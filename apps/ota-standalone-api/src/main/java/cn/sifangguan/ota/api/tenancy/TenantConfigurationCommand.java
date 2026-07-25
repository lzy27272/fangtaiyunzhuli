package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.authorization.OtaPermission;

import java.util.UUID;

public sealed interface TenantConfigurationCommand
        permits UpsertHotelConfigurationCommand, UpsertConnectorReferenceCommand, Sprint1TenantCommand {
    UUID targetTenantId();

    String idempotencyKey();

    long expectedRowVersion();

    String changeReasonCode();

    OtaPermission requiredPermission();
}
