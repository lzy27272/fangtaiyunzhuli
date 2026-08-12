package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.OtaRole;

import java.util.EnumSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/** Maps server-trusted AI platform roles into the frozen OTA role matrix. */
public final class PlatformRoleMapper {
    private static final Map<String, OtaRole> MAPPINGS = Map.ofEntries(
            Map.entry("PLATFORM_ADMIN", OtaRole.PLATFORM_ADMIN),
            Map.entry("OTA_OPERATION_ASSISTANT", OtaRole.OTA_OPERATION_ASSISTANT),
            Map.entry("OTA_OPERATION_MANAGER", OtaRole.OTA_OPERATION_MANAGER),
            Map.entry("CEO", OtaRole.CEO),
            Map.entry("REGIONAL_MANAGER", OtaRole.REGIONAL_MANAGER),
            Map.entry("GENERAL_MANAGER", OtaRole.GENERAL_MANAGER),
            Map.entry("ASSISTANT_GENERAL_MANAGER", OtaRole.ASSISTANT_GENERAL_MANAGER),
            Map.entry("FRONT_OFFICE_SUPERVISOR", OtaRole.FRONT_OFFICE_SUPERVISOR));

    public MappingResult map(Set<String> platformRoleCodes) {
        Objects.requireNonNull(platformRoleCodes, "platformRoleCodes");
        Set<OtaRole> mapped = EnumSet.noneOf(OtaRole.class);
        int ignoredRoleCount = 0;
        boolean legacyRevenueRoleObserved = false;
        for (String roleCode : platformRoleCodes) {
            if (roleCode == null || roleCode.isBlank()) {
                ignoredRoleCount++;
                continue;
            }
            OtaRole role = MAPPINGS.get(roleCode);
            if (role == null) {
                ignoredRoleCount++;
                legacyRevenueRoleObserved |= "REVENUE_MANAGER".equals(roleCode);
            } else {
                mapped.add(role);
            }
        }
        return new MappingResult(mapped, ignoredRoleCount, legacyRevenueRoleObserved);
    }

    public record MappingResult(
            Set<OtaRole> roles,
            int ignoredRoleCount,
            boolean legacyRevenueRoleObserved
    ) {
        public MappingResult {
            roles = Set.copyOf(Objects.requireNonNull(roles, "roles"));
            if (ignoredRoleCount < 0) {
                throw new IllegalArgumentException("ignoredRoleCount must not be negative");
            }
        }
    }
}
