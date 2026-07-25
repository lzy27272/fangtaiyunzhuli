package cn.sifangguan.ota.contracts.common;

import java.util.Objects;
import java.util.UUID;

public record TenantHotelRef(UUID tenantId, UUID hotelId) {
    public TenantHotelRef {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
    }
}
