package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;

public final class ConnectorAdmissionReadinessService {
    private final ConnectorAdmissionReadinessPort port;
    private final TenantContextExecutor tenants;

    public ConnectorAdmissionReadinessService(
            ConnectorAdmissionReadinessPort port,
            TenantContextExecutor tenants
    ) {
        this.port = Objects.requireNonNull(port, "port");
        this.tenants = Objects.requireNonNull(tenants, "tenants");
    }

    public List<ConnectorContractAdmissionView> listReadiness(
            AccountView account,
            UUID tenantId,
            UUID hotelId
    ) {
        requireGlobalRead(account);
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        return tenants.inTenant(
                tenantId,
                true,
                () -> port.listReadiness(hotelId));
    }

    private static void requireGlobalRead(AccountView account) {
        Objects.requireNonNull(account, "account");
        if (account.roles().stream().noneMatch(OtaRole::hasGlobalReadAccess)) {
            throw new SecurityException("Global OTA read access is required");
        }
    }
}
