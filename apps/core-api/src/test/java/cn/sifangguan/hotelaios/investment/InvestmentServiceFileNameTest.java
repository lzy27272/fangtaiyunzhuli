package cn.sifangguan.hotelaios.investment;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class InvestmentServiceFileNameTest {
    @Test
    void reportNameUsesProjectNameAndInvestmentCalculationSuffix() {
        assertEquals("贵阳青云市集酒店项目投资测算.pdf",
                InvestmentService.investmentReportFileName("贵阳青云市集酒店", "pdf"));
        assertEquals("贵阳青云市集酒店项目投资测算.xlsx",
                InvestmentService.investmentReportFileName("贵阳青云市集酒店项目", "xlsx"));
        assertEquals("贵阳青云市集酒店项目投资测算.pdf",
                InvestmentService.investmentReportFileName("贵阳/青云:市集酒店项目投资测算", "pdf"));
    }
}
