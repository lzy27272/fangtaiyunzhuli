package cn.sifangguan.ota.contracts.gateway;

import java.util.Objects;
import java.util.UUID;

public record GatewayScope(UUID tenantId, UUID hotelId) {
    public GatewayScope {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
    }

    @Override
    public String toString() {
        return "GatewayScope[tenantId=<redacted>, hotelId=<redacted>]";
    }
}
