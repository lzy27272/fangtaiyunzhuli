package cn.sifangguan.ota.api.gateway;

import java.util.UUID;

/** Server-side scope lookup that binds an account to an exact tenant and hotel pair. */
@FunctionalInterface
public interface StoreScopeAuthorizationPort {
    boolean hasActiveScope(UUID accountId, UUID tenantId, UUID hotelId, String scopeType);
}
