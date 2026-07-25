package cn.sifangguan.ota.api.tenancy;

import java.util.List;
import java.util.UUID;

public interface EnabledTenantDirectoryPort {
    List<UUID> listEnabledTenantIds();
}
