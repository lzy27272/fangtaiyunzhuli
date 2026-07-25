package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;

import java.util.Objects;
import java.util.UUID;

public record Sprint1TenantCommand(
        UUID targetTenantId,
        UUID actorAccountId,
        String idempotencyKey,
        long expectedRowVersion,
        String changeReasonCode,
        String requestHash,
        Sprint1Mutations.Mutation mutation
) implements TenantConfigurationCommand {
    public Sprint1TenantCommand {
        Objects.requireNonNull(targetTenantId, "targetTenantId");
        Objects.requireNonNull(actorAccountId, "actorAccountId");
        Objects.requireNonNull(requestHash, "requestHash");
        Objects.requireNonNull(mutation, "mutation");
    }

    @Override
    public OtaPermission requiredPermission() {
        return mutation.requiredPermission();
    }
}
