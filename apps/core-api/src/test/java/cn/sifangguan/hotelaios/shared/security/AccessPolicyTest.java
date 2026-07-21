package cn.sifangguan.hotelaios.shared.security;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

class AccessPolicyTest {
    private final AccessPolicy policy = new AccessPolicy();

    @AfterEach
    void clear() {
        TenantContext.clear();
    }

    @Test
    void ceoCanManageConfiguration() {
        setPrincipal("CEO", Set.of());
        assertDoesNotThrow(policy::requireConfigurationAdmin);
    }

    @Test
    void storeEmployeeCannotManageConfiguration() {
        setPrincipal("FRONT_DESK", Set.of(UUID.randomUUID()));
        assertThrows(AccessDeniedException.class, policy::requireConfigurationAdmin);
    }

    @Test
    void storeManagerCannotUseAnotherHotelScope() {
        UUID ownHotel = UUID.randomUUID();
        setPrincipal("GENERAL_MANAGER", Set.of(ownHotel));
        assertDoesNotThrow(() -> policy.requireOrgScope(ownHotel));
        assertThrows(AccessDeniedException.class, () -> policy.requireOrgScope(UUID.randomUUID()));
    }

    private void setPrincipal(String role, Set<UUID> scopes) {
        TenantContext.set(new TenantPrincipal(
                UUID.randomUUID(), UUID.randomUUID(), role, scopes, UUID.randomUUID()
        ));
    }
}

