package cn.sifangguan.hotelaios.investment;

import org.apache.pdfbox.Loader;
import org.apache.pdfbox.text.PDFTextStripper;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ProfessionalInvestmentReportRendererTest {
    private final ProfessionalInvestmentCalculationEngine engine = new ProfessionalInvestmentCalculationEngine();
    private final ProfessionalInvestmentReportRenderer renderer = new ProfessionalInvestmentReportRenderer();

    @Test
    void exportsAnElevenPageProfessionalInvestorReport() throws Exception {
        var input = ProfessionalInvestmentCalculationEngineTest.referenceInput();
        byte[] pdf = renderer.render(input, engine.calculate(input, InvestmentCalculationEngineTest.activeParameters()));

        assertTrue(new String(pdf, 0, 8, StandardCharsets.ISO_8859_1).startsWith("%PDF-"));
        try (var document = Loader.loadPDF(pdf)) {
            assertEquals(11, document.getNumberOfPages());
            String text = new PDFTextStripper().getText(document);
            assertTrue(text.contains("304.21"));
            assertTrue(text.contains("12 年累计净现金收益"));
            assertTrue(text.contains("SIFANGGUAN HOTEL GROUP"));
            assertTrue(text.contains(input.projectName()));
            assertTrue(text.contains(input.projectName() + " | 投资分析书"));
            assertFalse(text.contains("四方馆酒店 AI OS"));
        }

        String previewOutput = System.getProperty("investment.professional.preview.output");
        if (previewOutput != null && !previewOutput.isBlank()) {
            Path output = Path.of(previewOutput).toAbsolutePath();
            Files.createDirectories(output.getParent());
            Files.write(output, pdf);
        }
    }
}
