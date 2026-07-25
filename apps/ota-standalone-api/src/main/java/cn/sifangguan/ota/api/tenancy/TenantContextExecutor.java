package cn.sifangguan.ota.api.tenancy;

import java.util.UUID;
import java.util.function.Supplier;

public interface TenantContextExecutor {
    <T> T inTenant(UUID tenantId, boolean readOnly, Supplier<T> work);
}
