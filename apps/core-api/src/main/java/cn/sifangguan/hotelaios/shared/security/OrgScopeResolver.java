package cn.sifangguan.hotelaios.shared.security;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;

/** Single server-side organization-scope decision point for all modules. */
@Component
public class OrgScopeResolver {
    public boolean canAccess(TenantPrincipal principal, UUID orgUnitId) {
        return principal.hasTenantScope() || principal.orgScopes().contains(orgUnitId);
    }

    public void requireAccess(TenantPrincipal principal, UUID orgUnitId) {
        if (!canAccess(principal, orgUnitId)) {
            throw new AccessDeniedException("目标组织不在当前账号的有效数据范围内");
        }
    }

    public Set<UUID> retainAccessible(TenantPrincipal principal, Collection<UUID> candidates) {
        if (principal.hasTenantScope()) {
            return Set.copyOf(candidates);
        }
        Set<UUID> result = new LinkedHashSet<>(candidates);
        result.retainAll(principal.orgScopes());
        return Set.copyOf(result);
    }
}
