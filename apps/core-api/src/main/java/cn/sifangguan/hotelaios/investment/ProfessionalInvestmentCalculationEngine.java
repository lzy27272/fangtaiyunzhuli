package cn.sifangguan.hotelaios.investment;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalAdrPlan;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalCalculationResult;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalMaintenanceUpgrade;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalPlanInput;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalYearlyResult;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;

@Component
public class ProfessionalInvestmentCalculationEngine {
    private static final BigDecimal MONTHS_PER_YEAR = BigDecimal.valueOf(12);
    private static final BigDecimal DAYS_PER_YEAR = BigDecimal.valueOf(365);
    private static final int CALCULATION_SCALE = 12;

    /**
     * Uses the tenant's active cost-parameter version, so the professional
     * report and the standard investment calculator share one cost basis.
     */
    public ProfessionalCalculationResult calculate(ProfessionalPlanInput input, CostParameterView parameters) {
        Map<Integer, BigDecimal> adrByYear = adrByYear(input);
        Map<Integer, ProfessionalMaintenanceUpgrade> upgradeByYear = upgradeByYear(input);

        BigDecimal annualRentAndPropertyCost = input.propertyAreaSqm()
                .multiply(input.rentPerSqmMonth().add(input.propertyFeePerSqmMonth()))
                .multiply(MONTHS_PER_YEAR);
        BigDecimal quarterlyRentAndPropertyCost = input.propertyAreaSqm()
                .multiply(input.rentPerSqmMonth().add(input.propertyFeePerSqmMonth()))
                .multiply(input.prepaidRentMonths());
        BigDecimal leaseDeposit = input.propertyAreaSqm()
                .multiply(input.rentPerSqmMonth().add(input.propertyFeePerSqmMonth()))
                .multiply(input.depositMonths());
        BigDecimal availableRoomNights = BigDecimal.valueOf(input.roomCount()).multiply(DAYS_PER_YEAR);
        BigDecimal soldRoomNights = availableRoomNights.multiply(input.occupancyRate());
        BigDecimal annualLaborCost = BigDecimal.valueOf(input.staffCount())
                .multiply(parameters.salaryPerPersonMonth())
                .multiply(MONTHS_PER_YEAR);
        BigDecimal operationCost = "FOUR_DIAMOND".equals(input.projectPositioning())
                ? parameters.fourDiamondOperationsPerRoomNight()
                : parameters.threeDiamondOperationsPerRoomNight();
        BigDecimal unitVariableCost = parameters.consumablesPerRoomNight()
                .add(parameters.linenPerRoomNight())
                .add(parameters.utilitiesPerRoomNight())
                .add(operationCost);
        BigDecimal annualVariableCost = soldRoomNights.multiply(unitVariableCost);
        BigDecimal annualOperatingAndFixedCost = annualRentAndPropertyCost
                .add(annualLaborCost)
                .add(annualVariableCost);

        List<ProfessionalYearlyResult> yearly = new ArrayList<>();
        BigDecimal totalRevenue = BigDecimal.ZERO;
        BigDecimal totalManagementFee = BigDecimal.ZERO;
        BigDecimal totalMaintenanceUpgrade = BigDecimal.ZERO;
        BigDecimal totalAnnualProfit = BigDecimal.ZERO;
        BigDecimal cumulativeCashFlow = input.initialInvestment().negate();
        List<BigDecimal> cashFlows = new ArrayList<>();
        cashFlows.add(input.initialInvestment().negate());

        for (int year = 1; year <= input.leaseTermYears(); year++) {
            BigDecimal adr = adrByYear.get(year);
            BigDecimal revenue = soldRoomNights.multiply(adr);
            BigDecimal managementFee = revenue.multiply(input.managementFeeRate());
            BigDecimal maintenanceUpgrade = upgradeByYear.containsKey(year)
                    ? upgradeByYear.get(year).amount() : BigDecimal.ZERO;
            BigDecimal annualProfit = revenue
                    .subtract(annualOperatingAndFixedCost)
                    .subtract(managementFee)
                    .subtract(maintenanceUpgrade);
            BigDecimal cashFlow = annualProfit;
            if (year == 1) cashFlow = cashFlow.add(quarterlyRentAndPropertyCost);
            if (year == input.leaseTermYears()) cashFlow = cashFlow.add(leaseDeposit);
            cumulativeCashFlow = cumulativeCashFlow.add(cashFlow);

            yearly.add(new ProfessionalYearlyResult(
                    year, money(adr), money(revenue), money(managementFee),
                    money(annualOperatingAndFixedCost), money(maintenanceUpgrade), money(annualProfit),
                    money(cashFlow), money(cumulativeCashFlow)
            ));
            totalRevenue = totalRevenue.add(revenue);
            totalManagementFee = totalManagementFee.add(managementFee);
            totalMaintenanceUpgrade = totalMaintenanceUpgrade.add(maintenanceUpgrade);
            totalAnnualProfit = totalAnnualProfit.add(annualProfit);
            cashFlows.add(cashFlow);
        }

        BigDecimal netCashGain = cashFlows.stream().reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal roi = netCashGain.divide(input.initialInvestment(), CALCULATION_SCALE, RoundingMode.HALF_UP);
        BigDecimal paybackYears = paybackYears(cashFlows);
        BigDecimal irr = irr(cashFlows);
        BigDecimal npv = npv(cashFlows, input.discountRate());
        List<String> warnings = warnings(input, yearly, paybackYears, irr);

        return new ProfessionalCalculationResult(
                money(annualRentAndPropertyCost), money(quarterlyRentAndPropertyCost), money(leaseDeposit),
                money(annualLaborCost), money(annualVariableCost), money(unitVariableCost), money(annualOperatingAndFixedCost),
                quantity(availableRoomNights), quantity(soldRoomNights), money(totalRevenue), money(totalManagementFee),
                money(totalMaintenanceUpgrade), money(totalAnnualProfit), money(netCashGain), rate(roi),
                decimal(paybackYears, 2), rate(irr), money(npv), rate(input.discountRate()),
                List.copyOf(yearly), List.copyOf(warnings)
        );
    }

    private Map<Integer, BigDecimal> adrByYear(ProfessionalPlanInput input) {
        Map<Integer, BigDecimal> adrByYear = new LinkedHashMap<>();
        for (ProfessionalAdrPlan item : input.adrPlan()) {
            if (item.year() > input.leaseTermYears() || adrByYear.putIfAbsent(item.year(), item.adr()) != null) {
                throw badRequest("ADR 年度计划必须在租期内且每年仅能填写一次");
            }
        }
        if (adrByYear.size() != input.leaseTermYears()) {
            throw badRequest("ADR 年度计划须覆盖租期内的每一个年度");
        }
        for (int year = 1; year <= input.leaseTermYears(); year++) {
            if (!adrByYear.containsKey(year)) throw badRequest("ADR 年度计划缺少第 " + year + " 年");
        }
        return adrByYear;
    }

    private Map<Integer, ProfessionalMaintenanceUpgrade> upgradeByYear(ProfessionalPlanInput input) {
        Map<Integer, ProfessionalMaintenanceUpgrade> result = new LinkedHashMap<>();
        for (ProfessionalMaintenanceUpgrade item : input.maintenanceUpgrades() == null ? List.<ProfessionalMaintenanceUpgrade>of() : input.maintenanceUpgrades()) {
            if (item.year() > input.leaseTermYears() || result.putIfAbsent(item.year(), item) != null) {
                throw badRequest("维护升级计划必须在租期内且每年仅能填写一次");
            }
        }
        return result;
    }

    private BigDecimal paybackYears(List<BigDecimal> cashFlows) {
        BigDecimal cumulative = cashFlows.getFirst();
        for (int year = 1; year < cashFlows.size(); year++) {
            BigDecimal current = cashFlows.get(year);
            BigDecimal previous = cumulative;
            cumulative = cumulative.add(current);
            if (previous.signum() < 0 && cumulative.signum() >= 0 && current.signum() > 0) {
                return BigDecimal.valueOf(year - 1).add(previous.negate().divide(current, CALCULATION_SCALE, RoundingMode.HALF_UP));
            }
        }
        return null;
    }

    private BigDecimal irr(List<BigDecimal> cashFlows) {
        double lower = -0.9999d;
        double upper = 1.0d;
        double lowerValue = npvDouble(cashFlows, lower);
        double upperValue = npvDouble(cashFlows, upper);
        while (sameSign(lowerValue, upperValue) && upper < 1_000d) {
            upper = upper * 2d + 1d;
            upperValue = npvDouble(cashFlows, upper);
        }
        if (sameSign(lowerValue, upperValue)) return null;
        for (int iteration = 0; iteration < 160; iteration++) {
            double middle = (lower + upper) / 2d;
            double middleValue = npvDouble(cashFlows, middle);
            if (Math.abs(middleValue) < 0.0001d) return rate(BigDecimal.valueOf(middle));
            if (sameSign(lowerValue, middleValue)) {
                lower = middle;
                lowerValue = middleValue;
            } else {
                upper = middle;
            }
        }
        return rate(BigDecimal.valueOf((lower + upper) / 2d));
    }

    private boolean sameSign(double left, double right) {
        return Math.signum(left) == Math.signum(right);
    }

    private double npvDouble(List<BigDecimal> cashFlows, double discountRate) {
        double total = 0d;
        for (int period = 0; period < cashFlows.size(); period++) {
            total += cashFlows.get(period).doubleValue() / Math.pow(1d + discountRate, period);
        }
        return total;
    }

    private BigDecimal npv(List<BigDecimal> cashFlows, BigDecimal discountRate) {
        BigDecimal factor = BigDecimal.ONE;
        BigDecimal total = BigDecimal.ZERO;
        BigDecimal base = BigDecimal.ONE.add(discountRate);
        for (BigDecimal cashFlow : cashFlows) {
            total = total.add(cashFlow.divide(factor, CALCULATION_SCALE, RoundingMode.HALF_UP));
            factor = factor.multiply(base);
        }
        return total;
    }

    private List<String> warnings(
            ProfessionalPlanInput input,
            List<ProfessionalYearlyResult> yearly,
            BigDecimal paybackYears,
            BigDecimal irr
    ) {
        List<String> warnings = new ArrayList<>();
        if (yearly.stream().anyMatch(item -> item.annualProfit().signum() < 0)) {
            warnings.add("部分年度经营净现金收益为负，报告已按年度 ADR 与维护投入完整体现。");
        }
        if (paybackYears == null) warnings.add("按当前租期内现金流，首期投资尚未完全回收。");
        if (irr == null) warnings.add("当前现金流无法形成单一可解释的 IRR，建议重点查看 NPV 与逐年现金流。");
        if (input.maintenanceUpgrades() == null || input.maintenanceUpgrades().isEmpty()) {
            warnings.add("未设置中后期维护升级投入，建议结合产品周期补充复投计划。");
        }
        return warnings;
    }

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    static BigDecimal money(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }

    static BigDecimal quantity(BigDecimal value) {
        return value == null ? null : value.setScale(2, RoundingMode.HALF_UP);
    }

    static BigDecimal rate(BigDecimal value) {
        return value == null ? null : value.setScale(6, RoundingMode.HALF_UP);
    }

    static BigDecimal decimal(BigDecimal value, int scale) {
        return value == null ? null : value.setScale(scale, RoundingMode.HALF_UP);
    }
}
