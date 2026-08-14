package cn.sifangguan.hotelaios.investment;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProfessionalInvestmentCalculationEngineTest {
    private final ProfessionalInvestmentCalculationEngine engine = new ProfessionalInvestmentCalculationEngine();

    @Test
    void calculatesTwelveYearHotelCashFlowsFromTheProfessionalInputs() {
        var result = engine.calculate(referenceInput(), InvestmentCalculationEngineTest.activeParameters());

        assertEquals(new BigDecimal("1060800.00"), result.annualRentAndPropertyCost());
        assertEquals(new BigDecimal("265200.00"), result.quarterlyRentAndPropertyCost());
        assertEquals(new BigDecimal("88400.00"), result.leaseDeposit());
        assertEquals(new BigDecimal("726000.00"), result.annualLaborCost());
        assertEquals(new BigDecimal("1255322.60"), result.annualVariableCost());
        assertEquals(new BigDecimal("56.00"), result.unitVariableCost());
        assertEquals(new BigDecimal("3042122.60"), result.annualOperatingAndFixedCost());
        assertEquals(new BigDecimal("22416.48"), result.soldRoomNights());
        assertEquals(new BigDecimal("45281279.50"), result.totalRevenue());
        assertEquals(new BigDecimal("5711744.33"), result.totalAnnualProfit());
        assertEquals(new BigDecimal("3065344.33"), result.netCashGain());
        assertEquals(new BigDecimal("1.021781"), result.roi());
        assertEquals(12, result.yearlyResults().size());
        assertEquals(new BigDecimal("1056294.63"), result.yearlyResults().getFirst().cashFlow());
        assertNotNull(result.paybackYears());
        assertNotNull(result.irr());
        assertTrue(result.irr().compareTo(new BigDecimal("0.10")) > 0);
        assertTrue(result.irr().compareTo(new BigDecimal("0.30")) < 0);
        assertTrue(result.npv().compareTo(BigDecimal.ZERO) > 0);
    }

    @Test
    void appliesThePositioningSpecificOperatingCostPerSoldRoomNight() {
        var fourDiamond = engine.calculate(referenceInput(), InvestmentCalculationEngineTest.activeParameters());
        var threeDiamondInput = new ProfessionalInvestmentModels.ProfessionalPlanInput(
                "测试项目", null, null, null, 71, new BigDecimal("4420"), new BigDecimal("20"), BigDecimal.ZERO, 12,
                new BigDecimal("0.865"), new BigDecimal("0.05"), 11, "THREE_DIAMOND", new BigDecimal("3000000"),
                new BigDecimal("3"), BigDecimal.ONE, new BigDecimal("0.10"), referenceInput().adrPlan(),
                referenceInput().maintenanceUpgrades(), null
        );

        var threeDiamond = engine.calculate(threeDiamondInput, InvestmentCalculationEngineTest.activeParameters());

        assertEquals(new BigDecimal("41.00"), threeDiamond.unitVariableCost());
        assertEquals(new BigDecimal("2705875.48"), threeDiamond.annualOperatingAndFixedCost());
        assertEquals(new BigDecimal("336247.12"), fourDiamond.annualOperatingAndFixedCost()
                .subtract(threeDiamond.annualOperatingAndFixedCost()));
    }

    static ProfessionalInvestmentModels.ProfessionalPlanInput referenceInput() {
        return new ProfessionalInvestmentModels.ProfessionalPlanInput(
                "贵阳观山湖酒店", "贵阳市观山湖区", "四方馆酒店", "四方馆集团统一管理",
                71, new BigDecimal("4420"), new BigDecimal("20"), BigDecimal.ZERO, 12,
                new BigDecimal("0.865"), new BigDecimal("0.05"), 11, "FOUR_DIAMOND", new BigDecimal("3000000"),
                new BigDecimal("3"), BigDecimal.ONE, new BigDecimal("0.10"),
                List.of(
                        adr(1, 180), adr(2, 180), adr(3, 180), adr(4, 160), adr(5, 180), adr(6, 170),
                        adr(7, 160), adr(8, 150), adr(9, 180), adr(10, 170), adr(11, 160), adr(12, 150)
                ),
                List.of(
                        new ProfessionalInvestmentModels.ProfessionalMaintenanceUpgrade(4, new BigDecimal("400000"), "产品维护升级"),
                        new ProfessionalInvestmentModels.ProfessionalMaintenanceUpgrade(8, new BigDecimal("400000"), "产品维护升级")
                ),
                null
        );
    }

    private static ProfessionalInvestmentModels.ProfessionalAdrPlan adr(int year, int price) {
        return new ProfessionalInvestmentModels.ProfessionalAdrPlan(year, BigDecimal.valueOf(price));
    }
}
