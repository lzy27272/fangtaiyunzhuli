package cn.sifangguan.hotelaios.performance;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KpiWorkbookAnalyzerTest {
    @Test
    void recognizesStoreRoleWorkbookWhenFixtureIsProvided() throws Exception {
        String fixture = System.getProperty("kpi.import.workbook", "");
        Assumptions.assumeTrue(!fixture.isBlank() && Files.isRegularFile(Path.of(fixture)),
                "set -Dkpi.import.workbook to run the real workbook acceptance test");
        SimpleXlsxReader reader = new SimpleXlsxReader();
        KpiWorkbookAnalyzer analyzer = new KpiWorkbookAnalyzer();
        List<KpiWorkbookAnalyzer.PositionOption> positions = List.of(
                position("GENERAL_MANAGER", "店总"),
                position("ASSISTANT_GENERAL_MANAGER", "店助"),
                position("FRONT_OFFICE_SUPERVISOR", "前厅主管"),
                position("FRONT_DESK", "前台员工"),
                position("HOUSEKEEPING_ATTENDANT", "客房服务员")
        );

        KpiWorkbookAnalyzer.Analysis result = analyzer.analyze(
                reader.readWorkbook(Files.readAllBytes(Path.of(fixture))), positions);

        assertEquals(5, result.templates().size());
        assertEquals(6, result.ignoredSheets().size());
        Map<String, Integer> expectedIndicatorCounts = Map.of(
                "店长", 9,
                "店助", 11,
                "服务管家", 10,
                "前台", 11,
                "客房", 6
        );
        for (KpiWorkbookAnalyzer.DetectedTemplate template : result.templates()) {
            assertEquals(expectedIndicatorCounts.get(template.sheetName()), template.indicators().size(),
                    template.sheetName());
            assertEquals(0, template.baseFullScore().compareTo(java.math.BigDecimal.valueOf(100)),
                    template.sheetName());
            assertTrue(template.suggestedPositionId() != null, template.sheetName());
        }
    }

    private KpiWorkbookAnalyzer.PositionOption position(String code, String name) {
        return new KpiWorkbookAnalyzer.PositionOption(UUID.randomUUID(), code, name);
    }
}
