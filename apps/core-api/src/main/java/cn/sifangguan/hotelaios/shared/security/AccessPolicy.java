package cn.sifangguan.hotelaios.shared.security;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import org.springframework.stereotype.Component;

import java.util.Set;
import java.util.UUID;

@Component
public class AccessPolicy {
    private static final Set<String> CONFIG_ADMINS = Set.of("PLATFORM_ADMIN", "GROUP_ADMIN", "CEO");
    private final OrgScopeResolver orgScopeResolver = new OrgScopeResolver();

    public TenantPrincipal principal() {
        return TenantContext.require();
    }

    public void requireConfigurationAdmin() {
        TenantPrincipal principal = principal();
        if (!principal.hasPermission("iam.manage")
                && principal.roleCodes().stream().noneMatch(CONFIG_ADMINS::contains)) {
            throw new AccessDeniedException("当前角色无配置管理权限");
        }
    }

    public void requirePermission(String permissionCode) {
        TenantPrincipal principal = principal();
        if (!principal.hasPermission(permissionCode) && !principal.hasPermission("*")) {
            throw new AccessDeniedException("缺少权限：" + permissionCode);
        }
    }

    public void requireAnyPermission(String... permissionCodes) {
        TenantPrincipal principal = principal();
        for (String permissionCode : permissionCodes) {
            if (principal.hasPermission(permissionCode) || principal.hasPermission("*")) {
                return;
            }
        }
        throw new AccessDeniedException("缺少所需操作权限");
    }

    public void requireOrgScope(UUID orgUnitId) {
        orgScopeResolver.requireAccess(principal(), orgUnitId);
    }

    public void requireActiveAssignment(UUID assignmentId) {
        if (!principal().assignmentIds().contains(assignmentId)) {
            throw new AccessDeniedException("任职无效或不属于当前账号");
        }
    }
}
