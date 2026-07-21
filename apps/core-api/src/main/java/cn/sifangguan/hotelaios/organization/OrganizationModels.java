package cn.sifangguan.hotelaios.organization;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.time.LocalDate;
import java.util.UUID;

public final class OrganizationModels {
    private OrganizationModels() {
    }

    public record CreateOrgUnit(
            UUID parentId,
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String unitType,
            Integer sortOrder,
            String propertyCode,
            String city,
            Integer roomCount,
            LocalDate openingDate
    ) {
    }

    public record UpdateOrgUnit(
            @NotBlank String code,
            @NotBlank String name,
            Integer sortOrder,
            @NotBlank String status,
            String propertyCode,
            String city,
            Integer roomCount,
            LocalDate openingDate
    ) {
    }

    public record CreatePosition(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String jobFamily,
            String levelCode
    ) {
    }

    public record UpdatePosition(
            @NotBlank String code,
            @NotBlank String name,
            @NotBlank String jobFamily,
            String levelCode,
            @NotBlank String status
    ) {
    }

    public record CreateEmployee(
            @NotBlank String employeeNo,
            @NotBlank String name,
            String mobile,
            LocalDate hiredOn,
            String loginName,
            String temporaryPassword
    ) {
    }

    public record UpdateEmployee(
            @NotBlank String employeeNo,
            @NotBlank String name,
            String mobile,
            LocalDate hiredOn,
            @NotBlank String employmentStatus,
            String loginName,
            String temporaryPassword
    ) {
    }

    public record CreatePositionAssignment(
            @NotNull UUID orgUnitId,
            @NotNull UUID positionId,
            UUID managerAssignmentId,
            Boolean primary,
            String assignmentType,
            @NotNull LocalDate validFrom,
            LocalDate validTo
    ) {
    }
}
