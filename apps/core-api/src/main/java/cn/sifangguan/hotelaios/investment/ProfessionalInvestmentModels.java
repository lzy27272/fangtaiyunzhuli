package cn.sifangguan.hotelaios.investment;

import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Stateless inputs and outputs for the professional hotel investment report.
 * The figures are intentionally not persisted: a user can model a new deal
 * without altering the versioned investment-project records.
 */
public final class ProfessionalInvestmentModels {
    private ProfessionalInvestmentModels() {
    }

    public record ProfessionalReportRequest(@NotNull @Valid ProfessionalPlanInput input) {
    }

    public record UpdateProfessionalReportRequest(
            @NotNull @Valid ProfessionalPlanInput input,
            @PositiveOrZero long expectedVersion
    ) {
    }

    /** A lightweight row for the professional-report history list. */
    public record ProfessionalReportHistorySummary(
            UUID id,
            String projectName,
            int roomCount,
            BigDecimal initialInvestment,
            BigDecimal irr,
            BigDecimal npv,
            int costParameterVersionNo,
            int generationCount,
            long rowVersion,
            Instant createdAt,
            Instant updatedAt,
            Instant lastGeneratedAt
    ) {
    }

    /** The persisted input and calculation snapshot used to reproduce a report. */
    public record ProfessionalReportHistoryRecord(
            UUID id,
            String projectName,
            ProfessionalPlanInput input,
            ProfessionalCalculationResult calculation,
            int costParameterVersionNo,
            int generationCount,
            long rowVersion,
            Instant createdAt,
            Instant updatedAt,
            Instant lastGeneratedAt
    ) {
    }

    public record ProfessionalPlanInput(
            @NotBlank @Size(max = 100) String projectName,
            @Size(max = 120) String projectLocation,
            @Size(max = 80) String brandName,
            @Size(max = 80) String operatorName,
            @Positive int roomCount,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal propertyAreaSqm,
            @NotNull @DecimalMin("0") BigDecimal rentPerSqmMonth,
            @NotNull @DecimalMin("0") BigDecimal propertyFeePerSqmMonth,
            @Positive @Max(12) int leaseTermYears,
            @NotNull @DecimalMin(value = "0.01") @DecimalMax("1.00") BigDecimal occupancyRate,
            @NotNull @DecimalMin("0") @DecimalMax("0.20") BigDecimal managementFeeRate,
            @Positive int staffCount,
            @NotBlank @Pattern(regexp = "THREE_DIAMOND|FOUR_DIAMOND") String projectPositioning,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal initialInvestment,
            @NotNull @DecimalMin("0") @DecimalMax("24") BigDecimal prepaidRentMonths,
            @NotNull @DecimalMin("0") @DecimalMax("24") BigDecimal depositMonths,
            @NotNull @DecimalMin("0") @DecimalMax("0.50") BigDecimal discountRate,
            @NotEmpty @Size(max = 12) List<@Valid ProfessionalAdrPlan> adrPlan,
            @Size(max = 12) List<@Valid ProfessionalMaintenanceUpgrade> maintenanceUpgrades,
            @Valid ProfessionalReportNarrative reportNarrative
    ) {
    }

    public record ProfessionalAdrPlan(@Positive int year, @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal adr) {
    }

    public record ProfessionalMaintenanceUpgrade(
            @Positive int year,
            @NotNull @DecimalMin(value = "0", inclusive = false) BigDecimal amount,
            @Size(max = 160) String purpose
    ) {
    }

    /**
     * Optional investor-communication facts. They are deliberately separate
     * from the calculation inputs: changing narrative content cannot alter a
     * project's financial results.
     */
    public record ProfessionalReportNarrative(
            @Size(max = 400) String projectStatus,
            @Size(max = 500) String marketContext,
            @DecimalMin(value = "0", inclusive = false) BigDecimal sameScaleNewHotelInvestment,
            @DecimalMin("0") BigDecimal marketRentLow,
            @DecimalMin("0") BigDecimal marketRentHigh,
            @PositiveOrZero Integer localOperatingHotelCount,
            @Size(max = 800) String operationEvidence,
            @Size(max = 400) String productPositioning,
            @Size(max = 800) String upgradeStrategy,
            @Positive Integer totalShares,
            @Positive Integer minimumSubscriptionShares,
            @Size(max = 40) String distributionFrequency,
            @PositiveOrZero Integer lockupYears,
            @Positive Integer exitStartYear,
            @DecimalMin("0") @DecimalMax("1.00") BigDecimal annualExitDepreciationRate
    ) {
    }

    public record ProfessionalYearlyResult(
            int year,
            BigDecimal adr,
            BigDecimal annualRevenue,
            BigDecimal annualManagementFee,
            BigDecimal annualOperatingAndFixedCost,
            BigDecimal maintenanceUpgrade,
            BigDecimal annualProfit,
            BigDecimal cashFlow,
            BigDecimal cumulativeCashFlow
    ) {
    }

    public record ProfessionalCalculationResult(
            BigDecimal annualRentAndPropertyCost,
            BigDecimal quarterlyRentAndPropertyCost,
            BigDecimal leaseDeposit,
            BigDecimal annualLaborCost,
            BigDecimal annualVariableCost,
            BigDecimal unitVariableCost,
            BigDecimal annualOperatingAndFixedCost,
            BigDecimal availableRoomNights,
            BigDecimal soldRoomNights,
            BigDecimal totalRevenue,
            BigDecimal totalManagementFee,
            BigDecimal totalMaintenanceUpgrade,
            BigDecimal totalAnnualProfit,
            BigDecimal netCashGain,
            BigDecimal roi,
            BigDecimal paybackYears,
            BigDecimal irr,
            BigDecimal npv,
            BigDecimal discountRate,
            List<ProfessionalYearlyResult> yearlyResults,
            List<String> warnings
    ) {
    }
}
