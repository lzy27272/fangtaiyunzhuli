package cn.sifangguan.hotelaios.investment;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.CalculationResult;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CalculationWarning;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.PlanInput;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.ScenarioResult;

@Component
public class InvestmentCalculationEngine {
    static final BigDecimal MONTHS_PER_YEAR = BigDecimal.valueOf(12);
    static final BigDecimal DAYS_PER_YEAR = BigDecimal.valueOf(365);
    static final List<BigDecimal> OCCUPANCY_SCENARIOS = List.of(
            new BigDecimal("0.80"),
            new BigDecimal("0.85"),
            new BigDecimal("0.90"),
            new BigDecimal("0.95")
    );

    public CalculationResult calculate(PlanInput input, CostParameterView parameters) {
        String positioning = normalizePositioning(input.positioning());
        BigDecimal annualPropertyCost = input.propertyAreaSqm()
                .multiply(input.rentPerSqmMonth().add(input.propertyFeePerSqmMonth()))
                .multiply(MONTHS_PER_YEAR);
        BigDecimal annualLaborCost = BigDecimal.valueOf(input.staffCount())
                .multiply(parameters.salaryPerPersonMonth())
                .multiply(MONTHS_PER_YEAR);
        BigDecimal annualFixedCost = annualPropertyCost.add(annualLaborCost);
        BigDecimal operations = "FOUR_DIAMOND".equals(positioning)
                ? parameters.fourDiamondOperationsPerRoomNight()
                : parameters.threeDiamondOperationsPerRoomNight();
        BigDecimal unitVariableCost = parameters.consumablesPerRoomNight()
                .add(parameters.linenPerRoomNight())
                .add(parameters.utilitiesPerRoomNight())
                .add(operations);
        BigDecimal availableRoomNights = BigDecimal.valueOf(input.roomCount()).multiply(DAYS_PER_YEAR);

        List<ScenarioResult> scenarios = OCCUPANCY_SCENARIOS.stream()
                .map(occupancy -> scenario(
                        occupancy,
                        input,
                        availableRoomNights,
                        annualPropertyCost,
                        annualLaborCost,
                        unitVariableCost
                ))
                .toList();

        BigDecimal contributionPerRoomNight = input.sellingRoomRate()
                .multiply(BigDecimal.ONE.subtract(input.managementFeeRate()))
                .subtract(unitVariableCost);
        BigDecimal breakEvenOccupancy = null;
        BigDecimal breakEvenAnnualRoomNights = null;
        BigDecimal breakEvenMonthlyRoomNights = null;
        if (contributionPerRoomNight.signum() > 0) {
            breakEvenAnnualRoomNights = annualFixedCost.divide(contributionPerRoomNight, 12, RoundingMode.HALF_UP);
            breakEvenMonthlyRoomNights = breakEvenAnnualRoomNights.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP);
            breakEvenOccupancy = breakEvenAnnualRoomNights.divide(availableRoomNights, 12, RoundingMode.HALF_UP);
        }

        List<CalculationWarning> warnings = warnings(input, unitVariableCost, breakEvenOccupancy, scenarios);
        boolean canConfirm = warnings.stream().noneMatch(CalculationWarning::blocksFormalConfirmation);
        String analysis = analysis(input, annualFixedCost, unitVariableCost, breakEvenOccupancy, scenarios, warnings);

        return new CalculationResult(
                money(annualFixedCost),
                money(annualPropertyCost),
                money(annualLaborCost),
                money(unitVariableCost),
                rate(breakEvenOccupancy),
                quantity(breakEvenAnnualRoomNights),
                quantity(breakEvenMonthlyRoomNights),
                canConfirm,
                List.copyOf(warnings),
                scenarios,
                analysis
        );
    }

    BigDecimal managementFee(BigDecimal annualRevenue, BigDecimal managementFeeRate) {
        return annualRevenue.multiply(managementFeeRate);
    }

    String rating(BigDecimal annualProfit, BigDecimal paybackYears) {
        if (annualProfit.signum() <= 0 || paybackYears == null) return "LOSS";
        if (paybackYears.compareTo(new BigDecimal("5")) > 0) return "HIGH_RISK";
        if (paybackYears.compareTo(new BigDecimal("4")) > 0) return "CAUTIOUS";
        if (paybackYears.compareTo(new BigDecimal("3")) > 0) return "FEASIBLE";
        return "QUALITY";
    }

    private ScenarioResult scenario(
            BigDecimal occupancy,
            PlanInput input,
            BigDecimal availableRoomNights,
            BigDecimal annualPropertyCost,
            BigDecimal annualLaborCost,
            BigDecimal unitVariableCost
    ) {
        BigDecimal soldRoomNights = availableRoomNights.multiply(occupancy);
        BigDecimal revenue = soldRoomNights.multiply(input.sellingRoomRate());
        BigDecimal variableCost = soldRoomNights.multiply(unitVariableCost);
        BigDecimal annualCost = annualPropertyCost.add(annualLaborCost).add(variableCost);
        BigDecimal managementFee = managementFee(revenue, input.managementFeeRate());
        BigDecimal profit = revenue.subtract(annualCost).subtract(managementFee);
        BigDecimal returnRate = profit.divide(input.investmentTotal(), 12, RoundingMode.HALF_UP);
        BigDecimal payback = profit.signum() > 0
                ? input.investmentTotal().divide(profit, 12, RoundingMode.HALF_UP)
                : null;
        return new ScenarioResult(
                rate(occupancy),
                quantity(availableRoomNights),
                quantity(soldRoomNights),
                quantity(soldRoomNights.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP)),
                money(revenue),
                money(revenue.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP)),
                money(annualPropertyCost),
                money(annualLaborCost),
                money(variableCost),
                money(annualCost),
                money(annualCost.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP)),
                money(managementFee),
                money(managementFee.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP)),
                money(profit),
                money(profit.divide(MONTHS_PER_YEAR, 12, RoundingMode.HALF_UP)),
                rate(returnRate),
                decimal(payback, 2),
                rating(profit, payback)
        );
    }

    private List<CalculationWarning> warnings(
            PlanInput input,
            BigDecimal unitVariableCost,
            BigDecimal breakEvenOccupancy,
            List<ScenarioResult> scenarios
    ) {
        List<CalculationWarning> warnings = new ArrayList<>();
        if (input.rentPerSqmMonth().signum() == 0) {
            warnings.add(new CalculationWarning("ZERO_RENT", "WARNING", false,
                    "租金为0，请确认属于自有物业、免租期或其他有效零租金安排。"));
        }
        if (input.propertyFeePerSqmMonth().signum() == 0) {
            warnings.add(new CalculationWarning("ZERO_PROPERTY_FEE", "WARNING", false,
                    "物业费为0，请确认属于减免或确实不存在物业费用。"));
        }
        if (input.sellingRoomRate().compareTo(unitVariableCost) <= 0) {
            warnings.add(new CalculationWarning("ADR_NOT_ABOVE_VARIABLE_COST", "BLOCKING", true,
                    "售卖房价不高于单房变动成本，当前模型无法形成正向单房贡献。"));
        }
        if (breakEvenOccupancy == null || breakEvenOccupancy.compareTo(BigDecimal.ONE) > 0) {
            warnings.add(new CalculationWarning("BREAK_EVEN_ABOVE_CAPACITY", "BLOCKING", true,
                    "盈亏平衡出租率超过100%，当前参数下无法实现经营盈利。"));
        }
        ScenarioResult highOccupancy = scenarios.get(scenarios.size() - 1);
        if (highOccupancy.annualProfit().signum() <= 0) {
            warnings.add(new CalculationWarning("LOSS_AT_95_PERCENT", "BLOCKING", true,
                    "95%出租率情景仍然亏损，禁止确认正式预测。"));
        }
        BigDecimal staffPerHundredRooms = BigDecimal.valueOf(input.staffCount())
                .multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(input.roomCount()), 4, RoundingMode.HALF_UP);
        if (staffPerHundredRooms.compareTo(BigDecimal.TEN) < 0
                || staffPerHundredRooms.compareTo(BigDecimal.valueOf(60)) > 0) {
            warnings.add(new CalculationWarning("STAFFING_RATIO_OUTLIER", "WARNING", false,
                    "人员配置低于每百间10人或高于每百间60人，请核对人员数量。"));
        }
        return warnings;
    }

    private String analysis(
            PlanInput input,
            BigDecimal annualFixedCost,
            BigDecimal unitVariableCost,
            BigDecimal breakEvenOccupancy,
            List<ScenarioResult> scenarios,
            List<CalculationWarning> warnings
    ) {
        ScenarioResult defaultScenario = scenarios.stream()
                .filter(item -> item.occupancyRate().compareTo(new BigDecimal("0.85")) == 0)
                .findFirst()
                .orElse(scenarios.get(0));
        String firstProfitable = scenarios.stream()
                .filter(item -> item.annualProfit().signum() > 0)
                .map(item -> item.occupancyRate().multiply(BigDecimal.valueOf(100)).stripTrailingZeros().toPlainString() + "%")
                .findFirst()
                .orElse("四档情景均未盈利");
        String breakEvenText = breakEvenOccupancy == null
                ? "无法形成有效盈亏平衡点"
                : display(breakEvenOccupancy.multiply(BigDecimal.valueOf(100))) + "%";
        return "本方案按" + ("FOUR_DIAMOND".equals(normalizePositioning(input.positioning())) ? "四钻" : "三钻")
                + "定位测算，年固定成本为" + display(annualFixedCost) + "元，单房变动成本为"
                + display(unitVariableCost) + "元。默认85%出租率下，年收入"
                + display(defaultScenario.annualRevenue()) + "元，年利润"
                + display(defaultScenario.annualProfit()) + "元，投资等级为"
                + ratingLabel(defaultScenario.rating()) + "。盈亏平衡出租率为" + breakEvenText
                + "，四档预测中首个盈利情景为" + firstProfitable + "。系统识别到"
                + warnings.size() + "项风险或复核提示；该文字为确定性规则生成的基础分析，不改变任何计算结果。";
    }

    static String normalizePositioning(String value) {
        String normalized = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        if (!"THREE_DIAMOND".equals(normalized) && !"FOUR_DIAMOND".equals(normalized)) {
            throw new IllegalArgumentException("项目定位只能选择三钻或四钻");
        }
        return normalized;
    }

    static String ratingLabel(String rating) {
        return switch (rating) {
            case "LOSS" -> "亏损";
            case "HIGH_RISK" -> "高风险";
            case "CAUTIOUS" -> "谨慎";
            case "FEASIBLE" -> "可行";
            case "QUALITY" -> "优质";
            default -> rating;
        };
    }

    private static BigDecimal money(BigDecimal value) {
        return decimal(value, 2);
    }

    private static String display(BigDecimal value) {
        return money(value).stripTrailingZeros().toPlainString();
    }

    private static BigDecimal quantity(BigDecimal value) {
        return decimal(value, 2);
    }

    private static BigDecimal rate(BigDecimal value) {
        return decimal(value, 4);
    }

    private static BigDecimal decimal(BigDecimal value, int scale) {
        return value == null ? null : value.setScale(scale, RoundingMode.HALF_UP);
    }
}
