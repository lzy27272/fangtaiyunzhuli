package cn.sifangguan.ota.api.tenancy;

import java.util.List;
import java.util.Map;
import java.util.UUID;

public record CrossTenantReadResult<T>(
        Coverage coverage,
        Map<UUID, T> values,
        List<TenantFailure> failures
) {
    public CrossTenantReadResult {
        values = Map.copyOf(values);
        failures = List.copyOf(failures);
    }

    public enum Coverage {
        COMPLETE,
        PARTIAL,
        UNAVAILABLE
    }

    public record TenantFailure(UUID tenantId, String reasonCode) {
    }
}
