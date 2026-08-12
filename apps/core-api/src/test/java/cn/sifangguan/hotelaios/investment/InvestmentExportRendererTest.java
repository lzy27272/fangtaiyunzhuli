package cn.sifangguan.hotelaios.investment;

import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.AuditEntry;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.InvestmentVersionView;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class InvestmentExportRendererTest {
    private final InvestmentCalculationEngine engine = new InvestmentCalculationEngine();
    private final InvestmentExportRenderer renderer = new InvestmentExportRenderer();

    @Test
    void xlsxContainsAllFiveAuditableWorksheets() throws Exception {
        byte[] bytes = renderer.renderXlsx("TZ-20260813-0001", version(), List.of(auditEntry()));

        assertEquals('P', bytes[0]);
        assertEquals('K', bytes[1]);
        List<String> entries = zipEntries(bytes);
        assertTrue(entries.contains("xl/worksheets/sheet1.xml"));
        assertTrue(entries.contains("xl/worksheets/sheet2.xml"));
        assertTrue(entries.contains("xl/worksheets/sheet3.xml"));
        assertTrue(entries.contains("xl/worksheets/sheet4.xml"));
        assertTrue(entries.contains("xl/worksheets/sheet5.xml"));
    }

    @Test
    void pdfSupportsOneOrMultipleSelectedOccupancyModels() throws Exception {
        byte[] oneModel = renderer.renderPdf("TZ-20260813-0001", version(), List.of(80));
        byte[] allModels = renderer.renderPdf("TZ-20260813-0001", version(), List.of(80, 85, 90, 95));

        String oneAscii = new String(oneModel, StandardCharsets.ISO_8859_1);
        String allAscii = new String(allModels, StandardCharsets.ISO_8859_1);
        assertTrue(oneAscii.startsWith("%PDF-1.4"));
        assertTrue(oneAscii.contains("/Count 4"));
        assertTrue(allAscii.startsWith("%PDF-1.4"));
        assertTrue(allAscii.contains("/Count 7"));

        String previewOutput = System.getProperty("investment.preview.output");
        if (previewOutput != null && !previewOutput.isBlank()) {
            Path output = Path.of(previewOutput).toAbsolutePath();
            Files.createDirectories(output.getParent());
            Files.write(output, allModels);
        }
    }

    private InvestmentVersionView version() {
        UUID projectId = UUID.fromString("20000000-0000-0000-0000-000000000001");
        UUID versionId = UUID.fromString("30000000-0000-0000-0000-000000000001");
        Instant now = Instant.parse("2026-08-13T00:00:00Z");
        var input = InvestmentCalculationEngineTest.defaultInput();
        var parameters = InvestmentCalculationEngineTest.activeParameters();
        return new InvestmentVersionView(
                versionId,
                projectId,
                1,
                "FORMAL",
                "杭州中心店投资预测",
                input,
                parameters,
                engine.calculate(input, parameters),
                "RULE_FALLBACK",
                0,
                parameters.createdBy(),
                parameters.createdBy(),
                now,
                now,
                now,
                true
        );
    }

    private AuditEntry auditEntry() {
        return new AuditEntry(
                UUID.fromString("40000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                "INVESTMENT_VERSION_CONFIRMED",
                "INVESTMENT_PLAN_VERSION",
                UUID.fromString("30000000-0000-0000-0000-000000000001"),
                "正式预测确认",
                Instant.parse("2026-08-13T00:00:00Z")
        );
    }

    private static List<String> zipEntries(byte[] bytes) throws Exception {
        List<String> names = new ArrayList<>();
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) names.add(entry.getName());
        }
        return names;
    }
}
