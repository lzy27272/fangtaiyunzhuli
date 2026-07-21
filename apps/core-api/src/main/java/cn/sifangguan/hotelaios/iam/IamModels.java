package cn.sifangguan.hotelaios.iam;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;

import java.time.OffsetDateTime;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;

public final class IamModels {
    private IamModels() {
    }

    public record CreateRole(@NotBlank String code, @NotBlank String name, String roleType) {
    }

    public record SetPermissions(@NotEmpty List<UUID> permissionIds) {
    }

    public record GrantRole(
            @NotNull UUID accountId,
            @NotNull UUID roleId,
            UUID scopeOrgUnitId,
            @NotBlank String scopeType,
            OffsetDateTime validFrom,
            OffsetDateTime validTo
    ) {
    }

    public record Me(
            UUID tenantId,
            Account account,
            Employee employee,
            String primaryRole,
            Set<String> roles,
            Set<String> permissions,
            boolean tenantScope,
            Set<UUID> organizationScopes,
            List<PositionAssignment> positionAssignments
    ) {
    }

    public record Account(UUID id, String loginName, String displayName, String status) {
    }

    public record Employee(UUID id, String employeeNo, String name, String employmentStatus) {
    }

    public record PositionAssignment(
            UUID id,
            UUID organizationId,
            String organizationCode,
            String organizationName,
            UUID positionId,
            String positionCode,
            String positionName,
            boolean primary,
            String assignmentType,
            LocalDate validFrom,
            LocalDate validTo
    ) {
    }
}
