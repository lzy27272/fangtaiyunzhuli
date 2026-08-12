package cn.sifangguan.hotelaios.investment;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.CalculationResult;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CalculationWarning;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.PlanInput;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.ScenarioResult;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InvestmentCalculationEngineTest {
    private final InvestmentCalculationEngine engine = new InvestmentCalculationEngine();

    @Test
    void managementFeeIsAnnualRevenueMultipliedBySelectedRate() {
        assertEquals(new BigDecimal("150000.00"),
                engine.managementFee(new BigDecimal("3000000.00"), new BigDecimal("0.05"))
                        .setScale(2));
    }

    @Test
    void calculatesFrozenFourScenarioModelAndMonthlyConversions() {
        CalculationResult result = engine.calculate(defaultInput(), activeParameters());

        assertEquals(new BigDecimal("1380000.00"), result.annualFixedCost());
        assertEquals(new BigDecimal("720000.00"), result.annualPropertyCost());
        assertEquals(new BigDecimal("660000.00"), result.annualLaborCost());
        assertEquals(new BigDecimal("56.00"), result.unitVariableCost());
        assertEquals(new BigDecimal("0.1651"), result.breakEvenOccupancyRate());
        assertTrue(result.formalConfirmationAllowed());
        assertEquals(4, result.scenarios().size());

        ScenarioResult eighty = result.scenarios().getFirst();
        assertEquals(new BigDecimal("0.8000"), eighty.occupancyRate());
        assertEquals(new BigDecimal("29200.00"), eighty.soldRoomNights());
        assertEquals(new BigDecimal("8760000.00"), eighty.annualRevenue());
        assertEquals(new BigDecimal("1635200.00"), eighty.annualVariableCost());
        assertEquals(new BigDecimal("3015200.00"), eighty.annualCost());
        assertEquals(new BigDecimal("438000.00"), eighty.annualManagementFee());
        assertEquals(new BigDecimal("5306800.00"), eighty.annualProfit());
        assertEquals(new BigDecimal("36500.00"), eighty.monthlyManagementFee());
        assertEquals(new BigDecimal("442233.33"), eighty.monthlyProfit());

        assertEquals(new BigDecimal("0.8500"), result.scenarios().get(1).occupancyRate());
        assertEquals(new BigDecimal("0.9000"), result.scenarios().get(2).occupancyRate());
        assertEquals(new BigDecimal("0.9500"), result.scenarios().get(3).occupancyRate());
    }

    @Test
    void appliesConfirmedPaybackRiskBoundaries() {
        assertEquals("LOSS", engine.rating(BigDecimal.ZERO, null));
        assertEquals("HIGH_RISK", engine.rating(BigDecimal.ONE, new BigDecimal("5.01")));
        assertEquals("CAUTIOUS", engine.rating(BigDecimal.ONE, new BigDecimal("5.00")));
        assertEquals("CAUTIOUS", engine.rating(BigDecimal.ONE, new BigDecimal("4.01")));
        assertEquals("FEASIBLE", engine.rating(BigDecimal.ONE, new BigDecimal("4.00")));
        assertEquals("FEASIBLE", engine.rating(BigDecimal.ONE, new BigDecimal("3.01")));
        assertEquals("QUALITY", engine.rating(BigDecimal.ONE, new BigDecimal("3.00")));
    }

    @Test
    void blocksFormalForecastWhenEvenHighOccupancyCannotRecoverCosts() {
        PlanInput input = new PlanInput(
                BigDecimal.ZERO,
                new BigDecimal("1000"),
                BigDecimal.ZERO,
                100,
                10,
                "FOUR_DIAMOND",
                new BigDecimal("0.05"),
                new BigDecimal("50"),
                new BigDecimal("20000000"),
                null,
                null
        );

        CalculationResult result = engine.calculate(input, activeParameters());

        assertFalse(result.formalConfirmationAllowed());
        assertNull(result.breakEvenOccupancyRate());
        assertTrue(result.warnings().stream().map(CalculationWarning::code)
                .anyMatch("ADR_NOT_ABOVE_VARIABLE_COST"::equals));
        assertTrue(result.warnings().stream().map(CalculationWarning::code)
                .anyMatch("LOSS_AT_95_PERCENT"::equals));
        assertTrue(result.warnings().stream().filter(CalculationWarning::blocksFormalConfirmation).count() >= 2);
    }

    static PlanInput defaultInput() {
        return new PlanInput(
                new BigDecimal("50"),
                new BigDecimal("1000"),
                new BigDecimal("10"),
                100,
                10,
                "FOUR_DIAMOND",
                new BigDecimal("0.05"),
                new BigDecimal("300"),
                new BigDecimal("20000000"),
                "用于单元测试",
                null
        );
    }

    static CostParameterView activeParameters() {
        UUID actor = UUID.fromString("00000000-0000-0000-0000-000000000001");
        return new CostParameterView(
                UUID.fromString("10000000-0000-0000-0000-000000000001"),
                1,
                "ACTIVE",
                new BigDecimal("5500"),
                new BigDecimal("6"),
                new BigDecimal("8"),
                new BigDecimal("12"),
                new BigDecimal("15"),
                new BigDecimal("30"),
                0,
                actor,
                actor,
                Instant.parse("2026-08-13T00:00:00Z"),
                Instant.parse("2026-08-13T00:00:00Z")
        );
    }
}
