package cn.sifangguan.hotelaios.investment;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class InvestmentModels {
    private InvestmentModels() {
    }

    public record PlanInput(
            @NotNull @DecimalMin("0") BigDecimal rentPerSqmMonth,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal propertyAreaSqm,
            @NotNull @DecimalMin("0") BigDecimal propertyFeePerSqmMonth,
            @Positive int roomCount,
            @Positive int staffCount,
            @NotBlank String positioning,
            @NotNull @DecimalMin("0.01") @DecimalMax("0.05") BigDecimal managementFeeRate,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal sellingRoomRate,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal investmentTotal,
            @Size(max = 1000) String notes,
            @Size(max = 8000) String reviewedAnalysis
    ) {
    }

    public record CreateProjectRequest(
            @NotBlank @Size(max = 100) String projectName,
            @NotNull @Valid PlanInput input
    ) {
    }

    public record UpdateDraftRequest(
            @NotBlank @Size(max = 100) String projectName,
            @NotNull @Valid PlanInput input,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record VersionCommand(@PositiveOrZero long expectedVersion) {
    }

    public record CostParameterInput(
            @NotNull @DecimalMin("0") BigDecimal salaryPerPersonMonth,
            @NotNull @DecimalMin("0") BigDecimal consumablesPerRoomNight,
            @NotNull @DecimalMin("0") BigDecimal linenPerRoomNight,
            @NotNull @DecimalMin("0") BigDecimal utilitiesPerRoomNight,
            @NotNull @DecimalMin("0") BigDecimal threeDiamondOperationsPerRoomNight,
            @NotNull @DecimalMin("0") BigDecimal fourDiamondOperationsPerRoomNight
    ) {
    }

    public record CreateCostParameterRequest(@NotNull @Valid CostParameterInput input) {
    }

    public record UpdateCostParameterRequest(
            @NotNull @Valid CostParameterInput input,
            @PositiveOrZero long expectedVersion
    ) {
    }

    public record CostParameterView(
            UUID id,
            int versionNo,
            String lifecycleStatus,
            BigDecimal salaryPerPersonMonth,
            BigDecimal consumablesPerRoomNight,
            BigDecimal linenPerRoomNight,
            BigDecimal utilitiesPerRoomNight,
            BigDecimal threeDiamondOperationsPerRoomNight,
            BigDecimal fourDiamondOperationsPerRoomNight,
            long rowVersion,
            UUID createdBy,
            UUID activatedBy,
            Instant createdAt,
            Instant activatedAt
    ) {
        public CostParameterInput asInput() {
            return new CostParameterInput(
                    salaryPerPersonMonth,
                    consumablesPerRoomNight,
                    linenPerRoomNight,
                    utilitiesPerRoomNight,
                    threeDiamondOperationsPerRoomNight,
                    fourDiamondOperationsPerRoomNight
            );
        }
    }

    public record CalculationWarning(
            String code,
            String severity,
            boolean blocksFormalConfirmation,
            String message
    ) {
    }

    public record ScenarioResult(
            BigDecimal occupancyRate,
            BigDecimal availableRoomNights,
            BigDecimal soldRoomNights,
            BigDecimal monthlySoldRoomNights,
            BigDecimal annualRevenue,
            BigDecimal monthlyRevenue,
            BigDecimal annualPropertyCost,
            BigDecimal annualLaborCost,
            BigDecimal annualVariableCost,
            BigDecimal annualCost,
            BigDecimal monthlyCost,
            BigDecimal annualManagementFee,
            BigDecimal monthlyManagementFee,
            BigDecimal annualProfit,
            BigDecimal monthlyProfit,
            BigDecimal investmentReturnRate,
            BigDecimal paybackYears,
            String rating
    ) {
    }

    public record CalculationResult(
            BigDecimal annualFixedCost,
            BigDecimal annualPropertyCost,
            BigDecimal annualLaborCost,
            BigDecimal unitVariableCost,
            BigDecimal breakEvenOccupancyRate,
            BigDecimal breakEvenAnnualRoomNights,
            BigDecimal breakEvenMonthlyRoomNights,
            boolean formalConfirmationAllowed,
            List<CalculationWarning> warnings,
            List<ScenarioResult> scenarios,
            String systemAnalysis
    ) {
    }

    public record InvestmentVersionView(
            UUID id,
            UUID projectId,
            int versionNo,
            String lifecycleStatus,
            String projectName,
            PlanInput input,
            CostParameterView costParameters,
            CalculationResult calculation,
            String analysisOrigin,
            long rowVersion,
            UUID createdBy,
            UUID confirmedBy,
            Instant createdAt,
            Instant updatedAt,
            Instant confirmedAt,
            boolean currentFormal
    ) {
    }

    public record InvestmentProjectSummary(
            UUID id,
            String projectNo,
            String name,
            String lifecycleStatus,
            Integer latestVersionNo,
            String latestVersionStatus,
            UUID currentFormalVersionId,
            BigDecimal defaultAnnualProfit,
            BigDecimal defaultPaybackYears,
            String defaultRating,
            Instant updatedAt
    ) {
    }

    public record InvestmentProjectDetail(
            UUID id,
            String projectNo,
            String name,
            String lifecycleStatus,
            UUID currentFormalVersionId,
            long rowVersion,
            Instant createdAt,
            Instant updatedAt,
            List<InvestmentVersionView> versions
    ) {
    }

    public record AuditEntry(
            UUID id,
            UUID actorId,
            String action,
            String resourceType,
            UUID resourceId,
            String details,
            Instant createdAt
    ) {
    }

    public record DownloadFile(String fileName, String mediaType, byte[] bytes) {
    }
}
