package cn.sifangguan.ota.api.tenancy;

import java.util.UUID;

public interface HotelScopeAuthorizationPort {
    boolean hasActiveScope(UUID accountId, UUID hotelId, String scopeType);
}
