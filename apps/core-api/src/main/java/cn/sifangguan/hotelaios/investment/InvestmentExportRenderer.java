package cn.sifangguan.hotelaios.investment;

import org.springframework.stereotype.Component;

import org.apache.fontbox.ttf.TrueTypeCollection;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.File;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import static cn.sifangguan.hotelaios.investment.InvestmentModels.AuditEntry;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.CostParameterView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.InvestmentVersionView;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.PlanInput;
import static cn.sifangguan.hotelaios.investment.InvestmentModels.ScenarioResult;

@Component
public class InvestmentExportRenderer {
    private static final long ZIP_ENTRY_TIME = 315_532_800_000L;
    private static final ZoneId DISPLAY_ZONE = ZoneId.of("Asia/Shanghai");
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    public byte[] renderXlsx(String projectNo, InvestmentVersionView version, List<AuditEntry> audit) {
        LinkedHashMap<String, List<List<Cell>>> sheets = new LinkedHashMap<>();
        sheets.put("项目概览", overviewRows(projectNo, version));
        sheets.put("情景分析", scenarioRows(version));
        sheets.put("成本明细", costRows(version));
        sheets.put("公式说明", formulaRows());
        sheets.put("审计记录", auditRows(audit));
        return xlsx(sheets);
    }

    public byte[] renderPdf(String projectNo, InvestmentVersionView version, List<Integer> occupancies) {
        List<ScenarioResult> selected = version.calculation().scenarios().stream()
                .filter(item -> occupancies.contains(item.occupancyRate()
                        .multiply(BigDecimal.valueOf(100)).intValue()))
                .toList();
        if (selected.isEmpty()) throw new IllegalArgumentException("至少选择一个出租率模型");

        int totalPages = 3 + selected.size();
        List<String> pages = new ArrayList<>();
        pages.add(coverPdfPage(projectNo, version, selected, 1, totalPages));
        pages.add(projectOverviewPdfPage(projectNo, version, 2, totalPages));
        pages.add(comparisonPdfPage(projectNo, version, selected, 3, totalPages));
        for (int index = 0; index < selected.size(); index++) {
            pages.add(scenarioPdfPage(projectNo, version, selected.get(index), index + 4, totalPages));
        }
        return pdf(pages);
    }

    private static List<List<Cell>> overviewRows(String projectNo, InvestmentVersionView version) {
        PlanInput input = version.input();
        ScenarioResult defaultScenario = version.calculation().scenarios().stream()
                .filter(item -> item.occupancyRate().compareTo(new BigDecimal("0.85")) == 0)
                .findFirst().orElse(version.calculation().scenarios().getFirst());
        List<List<Cell>> rows = new ArrayList<>();
        rows.add(row(Cell.header("四方馆 Hotel AI OS · 投资回报预测"), Cell.empty()));
        rows.add(row(Cell.section("项目编号"), Cell.text(projectNo)));
        rows.add(row(Cell.section("方案版本"), Cell.text(versionLabel(version))));
        rows.add(row(Cell.section("项目名称"), Cell.text(version.projectName())));
        rows.add(row(Cell.section("预测状态"), Cell.text(statusLabel(version.lifecycleStatus()))));
        rows.add(row(Cell.section("参数版本"), Cell.text("COST-V" + pad(version.costParameters().versionNo()))));
        rows.add(row(Cell.section("项目定位"), Cell.text(positioningLabel(input.positioning()))));
        rows.add(row(Cell.section("房间数"), Cell.number(input.roomCount())));
        rows.add(row(Cell.section("物业面积（㎡）"), Cell.number(input.propertyAreaSqm())));
        rows.add(row(Cell.section("租金（元/㎡/月）"), Cell.money(input.rentPerSqmMonth())));
        rows.add(row(Cell.section("物业费（元/㎡/月）"), Cell.money(input.propertyFeePerSqmMonth())));
        rows.add(row(Cell.section("人员数"), Cell.number(input.staffCount())));
        rows.add(row(Cell.section("管理费率"), Cell.percent(input.managementFeeRate())));
        rows.add(row(Cell.section("售卖房价（元/间夜）"), Cell.money(input.sellingRoomRate())));
        rows.add(row(Cell.section("投资总额（元）"), Cell.money(input.investmentTotal())));
        rows.add(row(Cell.empty(), Cell.empty()));
        rows.add(row(Cell.header("默认85%出租率核心预测"), Cell.empty()));
        rows.add(row(Cell.section("年营业收入"), Cell.money(defaultScenario.annualRevenue())));
        rows.add(row(Cell.section("年成本（不含管理费）"), Cell.money(defaultScenario.annualCost())));
        rows.add(row(Cell.section("年管理费"), Cell.money(defaultScenario.annualManagementFee())));
        rows.add(row(Cell.section("年利润"), Cell.money(defaultScenario.annualProfit())));
        rows.add(row(Cell.section("投资回报率"), Cell.percent(defaultScenario.investmentReturnRate())));
        rows.add(row(Cell.section("回收时长（年）"), defaultScenario.paybackYears() == null
                ? Cell.text("当前条件下无法回收") : Cell.number(defaultScenario.paybackYears())));
        rows.add(row(Cell.section("投资等级"), Cell.text(ratingLabel(defaultScenario.rating()))));
        rows.add(row(Cell.section("盈亏平衡出租率"), version.calculation().breakEvenOccupancyRate() == null
                ? Cell.text("无法形成") : Cell.percent(version.calculation().breakEvenOccupancyRate())));
        rows.add(row(Cell.empty(), Cell.empty()));
        rows.add(row(Cell.header("综合预测分析"), Cell.empty()));
        rows.add(row(Cell.section("系统原始结论"), Cell.text(version.calculation().systemAnalysis())));
        rows.add(row(Cell.section("确认分析"), Cell.text(hasText(input.reviewedAnalysis())
                ? input.reviewedAnalysis() : "未填写，正式报告沿用系统原始结论")));
        rows.add(row(Cell.section("异常与提示"), Cell.text(version.calculation().warnings().isEmpty()
                ? "无" : version.calculation().warnings().stream()
                .map(item -> item.message()).reduce((a, b) -> a + "；" + b).orElse("无"))));
        return rows;
    }

    private static List<List<Cell>> scenarioRows(InvestmentVersionView version) {
        List<List<Cell>> rows = new ArrayList<>();
        rows.add(row(
                Cell.header("出租率"), Cell.header("年开房量"), Cell.header("月均开房量"),
                Cell.header("年营业收入"), Cell.header("年物业成本"), Cell.header("年人工成本"),
                Cell.header("年单房变动成本"), Cell.header("年成本合计"), Cell.header("年管理费"),
                Cell.header("年利润"), Cell.header("投资回报率"), Cell.header("回收时长（年）"),
                Cell.header("投资等级")
        ));
        for (ScenarioResult item : version.calculation().scenarios()) {
            rows.add(row(
                    Cell.percent(item.occupancyRate()), Cell.number(item.soldRoomNights()),
                    Cell.number(item.monthlySoldRoomNights()), Cell.money(item.annualRevenue()),
                    Cell.money(item.annualPropertyCost()), Cell.money(item.annualLaborCost()),
                    Cell.money(item.annualVariableCost()), Cell.money(item.annualCost()),
                    Cell.money(item.annualManagementFee()), Cell.money(item.annualProfit()),
                    Cell.percent(item.investmentReturnRate()), item.paybackYears() == null
                            ? Cell.text("无法回收") : Cell.number(item.paybackYears()),
                    Cell.text(ratingLabel(item.rating()))
            ));
        }
        return rows;
    }

    private static List<List<Cell>> costRows(InvestmentVersionView version) {
        CostParameterView cost = version.costParameters();
        PlanInput input = version.input();
        BigDecimal operations = "FOUR_DIAMOND".equals(input.positioning())
                ? cost.fourDiamondOperationsPerRoomNight()
                : cost.threeDiamondOperationsPerRoomNight();
        return List.of(
                row(Cell.header("成本类型"), Cell.header("成本项目"), Cell.header("参数值"), Cell.header("单位/公式")),
                row(Cell.text("固定成本"), Cell.text("租金"), Cell.money(input.rentPerSqmMonth()), Cell.text("元/㎡/月")),
                row(Cell.text("固定成本"), Cell.text("物业费"), Cell.money(input.propertyFeePerSqmMonth()), Cell.text("元/㎡/月")),
                row(Cell.text("固定成本"), Cell.text("人员工资"), Cell.money(cost.salaryPerPersonMonth()), Cell.text("元/人/月")),
                row(Cell.text("单房变动成本"), Cell.text("易耗品"), Cell.money(cost.consumablesPerRoomNight()), Cell.text("元/已售间夜")),
                row(Cell.text("单房变动成本"), Cell.text("布草洗涤"), Cell.money(cost.linenPerRoomNight()), Cell.text("元/已售间夜")),
                row(Cell.text("单房变动成本"), Cell.text("水电"), Cell.money(cost.utilitiesPerRoomNight()), Cell.text("元/已售间夜")),
                row(Cell.text("单房变动成本"), Cell.text(positioningLabel(input.positioning()) + "运营费"), Cell.money(operations), Cell.text("元/已售间夜")),
                row(Cell.section("合计"), Cell.section("单房变动成本"), Cell.money(version.calculation().unitVariableCost()), Cell.text("元/已售间夜")),
                row(Cell.section("合计"), Cell.section("年固定成本"), Cell.money(version.calculation().annualFixedCost()), Cell.text("租金+物业费+人工")),
                row(Cell.section("版本"), Cell.text("成本参数版本"), Cell.text("COST-V" + pad(cost.versionNo())), Cell.text(statusLabel(cost.lifecycleStatus())))
        );
    }

    private static List<List<Cell>> formulaRows() {
        return List.of(
                row(Cell.header("指标"), Cell.header("确定性计算公式")),
                row(Cell.text("年开房量"), Cell.text("房间数量 × 365 × 出租率")),
                row(Cell.text("年营业收入"), Cell.text("年开房量 × 售卖房价")),
                row(Cell.text("年物业固定成本"), Cell.text("物业面积 ×（租金 + 物业费）× 12")),
                row(Cell.text("年人工成本"), Cell.text("人员数量 × 5,500（参数版本值）× 12")),
                row(Cell.text("年单房变动成本"), Cell.text("年开房量 × 单房变动成本")),
                row(Cell.text("年成本"), Cell.text("年物业固定成本 + 年人工成本 + 年单房变动成本")),
                row(Cell.text("年管理费"), Cell.text("年营业收入 × 管理费率")),
                row(Cell.text("年利润"), Cell.text("年营业收入 − 年成本 − 年管理费")),
                row(Cell.text("投资回报率"), Cell.text("年利润 ÷ 投资总额")),
                row(Cell.text("回收时长"), Cell.text("投资总额 ÷ 年利润；年利润≤0时不计算")),
                row(Cell.text("月均数据"), Cell.text("年度结果 ÷ 12")),
                row(Cell.text("盈亏平衡出租率"), Cell.text("年固定成本 ÷〔房间数 × 365 ×（房价 ×（1−管理费率）−单房变动成本）〕")),
                row(Cell.text("模型边界"), Cell.text("V1.0不包含融资、税费、折旧、残值、租金递增、免租期和装修停业期"))
        );
    }

    private static List<List<Cell>> auditRows(List<AuditEntry> audit) {
        List<List<Cell>> rows = new ArrayList<>();
        rows.add(row(Cell.header("时间"), Cell.header("操作"), Cell.header("操作人"),
                Cell.header("资源类型"), Cell.header("资源ID"), Cell.header("审计内容")));
        for (AuditEntry item : audit) {
            rows.add(row(
                    Cell.text(item.createdAt() == null ? "" : DATE_TIME.format(item.createdAt().atZone(DISPLAY_ZONE))),
                    Cell.text(item.action()),
                    Cell.text(item.actorId() == null ? "SYSTEM" : item.actorId().toString()),
                    Cell.text(item.resourceType()),
                    Cell.text(item.resourceId() == null ? "" : item.resourceId().toString()),
                    Cell.text(item.details())
            ));
        }
        return rows;
    }

    private static byte[] xlsx(LinkedHashMap<String, List<List<Cell>>> sheets) {
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            put(zip, "[Content_Types].xml", contentTypes(sheets.size()));
            put(zip, "_rels/.rels", rootRelationships());
            put(zip, "xl/workbook.xml", workbook(sheets.keySet().stream().toList()));
            put(zip, "xl/_rels/workbook.xml.rels", workbookRelationships(sheets.size()));
            put(zip, "xl/styles.xml", styles());
            int index = 1;
            for (List<List<Cell>> rows : sheets.values()) {
                put(zip, "xl/worksheets/sheet" + index + ".xml", worksheet(rows));
                index++;
            }
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("无法生成投资测算Excel", exception);
        }
    }

    private static String worksheet(List<List<Cell>> rows) {
        StringBuilder xml = new StringBuilder(8192);
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
                .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
                .append("<cols><col min=\"1\" max=\"1\" width=\"24\" customWidth=\"1\"/>")
                .append("<col min=\"2\" max=\"20\" width=\"20\" customWidth=\"1\"/></cols><sheetData>");
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            xml.append("<row r=\"").append(rowIndex + 1).append("\">");
            List<Cell> row = rows.get(rowIndex);
            for (int columnIndex = 0; columnIndex < row.size(); columnIndex++) {
                Cell cell = row.get(columnIndex);
                String reference = excelColumn(columnIndex + 1) + (rowIndex + 1);
                if (cell.numeric()) {
                    xml.append("<c r=\"").append(reference).append("\" s=\"").append(cell.style()).append("\"><v>")
                            .append(xmlText(cell.value())).append("</v></c>");
                } else {
                    xml.append("<c r=\"").append(reference).append("\" s=\"").append(cell.style())
                            .append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                            .append(xmlText(safeText(cell.value()))).append("</t></is></c>");
                }
            }
            xml.append("</row>");
        }
        return xml.append("</sheetData></worksheet>").toString();
    }

    private static String contentTypes(int count) {
        StringBuilder xml = new StringBuilder("""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
                """);
        for (int index = 1; index <= count; index++) {
            xml.append("<Override PartName=\"/xl/worksheets/sheet").append(index)
                    .append(".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>");
        }
        return xml.append("</Types>").toString();
    }

    private static String rootRelationships() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """;
    }

    private static String workbook(List<String> names) {
        StringBuilder xml = new StringBuilder("""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
                """);
        for (int index = 0; index < names.size(); index++) {
            xml.append("<sheet name=\"").append(xmlText(names.get(index))).append("\" sheetId=\"")
                    .append(index + 1).append("\" r:id=\"rId").append(index + 1).append("\"/>");
        }
        return xml.append("</sheets></workbook>").toString();
    }

    private static String workbookRelationships(int count) {
        StringBuilder xml = new StringBuilder("""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                """);
        for (int index = 1; index <= count; index++) {
            xml.append("<Relationship Id=\"rId").append(index)
                    .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet")
                    .append(index).append(".xml\"/>");
        }
        xml.append("<Relationship Id=\"rId").append(count + 1)
                .append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>");
        return xml.append("</Relationships>").toString();
    }

    private static String styles() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <numFmts count="3"><numFmt numFmtId="164" formatCode="0.##&quot;元&quot;"/><numFmt numFmtId="165" formatCode="0.##%"/><numFmt numFmtId="166" formatCode="0.##"/></numFmts>
                  <fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts>
                  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123A5A"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCEAF4"/><bgColor indexed="64"/></patternFill></fill></fills>
                  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
                  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
                  <cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>
                </styleSheet>
                """;
    }

    private static byte[] pdf(List<String> pageContents) {
        try (PDDocument document = new PDDocument();
             FontSet fonts = loadFonts(document);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            for (String pageContent : pageContents) {
                PDPage page = new PDPage(PDRectangle.A4);
                document.addPage(page);
                try (PDPageContentStream content = new PDPageContentStream(document, page)) {
                    drawPage(content, pageContent, fonts);
                }
            }
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("无法生成投资测算PDF", exception);
        }
    }

    private static FontSet loadFonts(PDDocument document) throws IOException {
        TrueTypeCollection serifCollection = new TrueTypeCollection(new File("C:/Windows/Fonts/simsun.ttc"));
        TrueTypeCollection sansCollection = new TrueTypeCollection(new File("C:/Windows/Fonts/msyh.ttc"));
        TrueTypeCollection boldCollection = new TrueTypeCollection(new File("C:/Windows/Fonts/msyhbd.ttc"));
        PDFont serif = PDType0Font.load(document, requireFont(serifCollection, "SimSun"), true);
        PDFont sans = PDType0Font.load(document, requireFont(sansCollection, "MicrosoftYaHei"), true);
        PDFont bold = PDType0Font.load(document, requireFont(boldCollection, "MicrosoftYaHei-Bold"), true);
        return new FontSet(serif, sans, bold, serifCollection, sansCollection, boldCollection);
    }

    private static TrueTypeFont requireFont(TrueTypeCollection collection, String name) throws IOException {
        return Objects.requireNonNull(collection.getFontByName(name), "未找到PDF字体：" + name);
    }

    private static void drawPage(PDPageContentStream content, String commands, FontSet fonts) throws IOException {
        for (String command : commands.split("\\n")) {
            if (command.isBlank()) continue;
            if (command.startsWith("RECT|")) {
                String[] part = command.split("\\|", -1);
                PdfColor color = decodeColor(part, 5);
                content.setNonStrokingColor((float) color.red(), (float) color.green(), (float) color.blue());
                content.addRect(parse(part[1]), parse(part[2]), parse(part[3]), parse(part[4]));
                content.fill();
            } else if (command.startsWith("STROKERECT|")) {
                String[] part = command.split("\\|", -1);
                PdfColor color = decodeColor(part, 5);
                content.setStrokingColor((float) color.red(), (float) color.green(), (float) color.blue());
                content.setLineWidth(parse(part[8]));
                content.addRect(parse(part[1]), parse(part[2]), parse(part[3]), parse(part[4]));
                content.stroke();
            } else if (command.startsWith("LINE|")) {
                String[] part = command.split("\\|", -1);
                PdfColor color = decodeColor(part, 5);
                content.setStrokingColor((float) color.red(), (float) color.green(), (float) color.blue());
                content.setLineWidth(parse(part[8]));
                content.moveTo(parse(part[1]), parse(part[2]));
                content.lineTo(parse(part[3]), parse(part[4]));
                content.stroke();
            } else if (command.startsWith("TEXT|")) {
                String[] part = command.split("\\|", 9);
                PdfColor color = decodeColor(part, 5);
                PDFont font = switch (part[8]) {
                    case "TITLE" -> fonts.serif();
                    case "BOLD" -> fonts.bold();
                    default -> fonts.sans();
                };
                content.beginText();
                content.setFont(font, parse(part[1]));
                content.setNonStrokingColor((float) color.red(), (float) color.green(), (float) color.blue());
                content.newLineAtOffset(parse(part[2]), parse(part[3]));
                content.showText(unescapeText(part[4]));
                content.endText();
            }
        }
    }

    private static float parse(String value) {
        return Float.parseFloat(value);
    }

    private static PdfColor decodeColor(String[] part, int index) {
        return new PdfColor(Double.parseDouble(part[index]), Double.parseDouble(part[index + 1]), Double.parseDouble(part[index + 2]));
    }

    private static String escapeText(String value) {
        return value.replace("\\", "\\\\").replace("|", "\\p").replace("\n", " ");
    }

    private static String unescapeText(String value) {
        return value.replace("\\p", "|").replace("\\\\", "\\");
    }

    private static final PdfColor DEEP_GREEN = new PdfColor(0.055, 0.245, 0.196);
    private static final PdfColor MID_GREEN = new PdfColor(0.102, 0.357, 0.286);
    private static final PdfColor SOFT_GREEN = new PdfColor(0.910, 0.941, 0.918);
    private static final PdfColor GOLD = new PdfColor(0.765, 0.608, 0.286);
    private static final PdfColor CREAM = new PdfColor(0.975, 0.961, 0.918);
    private static final PdfColor PAPER = new PdfColor(0.996, 0.992, 0.980);
    private static final PdfColor INK = new PdfColor(0.110, 0.180, 0.157);
    private static final PdfColor MUTED = new PdfColor(0.365, 0.430, 0.408);
    private static final PdfColor GRID = new PdfColor(0.820, 0.843, 0.808);
    private static final PdfColor WHITE = new PdfColor(1, 1, 1);
    private static final PdfColor RISK = new PdfColor(0.690, 0.255, 0.208);

    private static String coverPdfPage(
            String projectNo,
            InvestmentVersionView version,
            List<ScenarioResult> scenarios,
            int pageNo,
            int totalPages
    ) {
        ScenarioResult representative = representativeScenario(scenarios);
        PdfCanvas page = new PdfCanvas();
        page.fillPage(DEEP_GREEN);
        page.fillRect(50, 770, 76, 4, GOLD);
        page.text("SIFANGGUAN HOTEL AI OS", 9, 50, 744, GOLD, FontRole.BOLD);
        page.text("酒店投资分析书", 31, 50, 666, WHITE, FontRole.TITLE);
        page.text("HOTEL INVESTMENT ANALYSIS", 11, 52, 638, GOLD);
        page.text(version.projectName(), 18, 50, 584, WHITE, FontRole.TITLE);
        page.strokeLine(50, 559, 545, 559, GOLD, 0.8);
        page.text("项目编号  " + projectNo, 9, 50, 535, CREAM);
        page.text("预测版本  " + versionLabel(version), 9, 285, 535, CREAM);

        page.metricCard(50, 402, 237, 92, "总投资金额", amountWanText(version.input().investmentTotal()), "万元", GOLD);
        page.metricCard(308, 402, 237, 92, "全年均价", moneyText(version.input().sellingRoomRate()), "元 / 间夜", GOLD);
        page.metricCard(50, 290, 237, 92, percentText(representative.occupancyRate()) + " 年利润",
                amountWanText(representative.annualProfit()), "万元", SOFT_GREEN);
        page.metricCard(308, 290, 237, 92, "静态回收时长",
                representative.paybackYears() == null ? "无法回收" : numberText(representative.paybackYears()),
                representative.paybackYears() == null ? "" : "年 · " + ratingLabel(representative.rating()), SOFT_GREEN);

        page.fillRect(50, 105, 495, 138, CREAM);
        page.text("投资结论", 11, 70, 214, DEEP_GREEN);
        String conclusion = hasText(version.input().reviewedAnalysis())
                ? version.input().reviewedAnalysis() : version.calculation().systemAnalysis();
        page.wrapped(conclusion, 10, 70, 187, 43, 18, 5, INK);
        page.text("测算范围：" + scenarios.stream().map(item -> percentText(item.occupancyRate())).reduce((a, b) -> a + " / " + b).orElse("—"),
                8, 70, 125, MUTED);
        page.text("内部经营资料 · 由确定性公式生成", 8, 50, 55, CREAM);
        page.text("第 " + pageNo + " / " + totalPages + " 页", 8, 475, 55, CREAM);
        return page.content();
    }

    private static String projectOverviewPdfPage(String projectNo, InvestmentVersionView version, int pageNo, int totalPages) {
        PdfCanvas page = new PdfCanvas();
        page.standardPage("01", "项目概况与测算口径", projectNo, version, pageNo, totalPages);

        String[][] overview = {
                {"项目名称", version.projectName(), "方案版本", versionLabel(version)},
                {"项目定位", positioningLabel(version.input().positioning()), "房间数量", version.input().roomCount() + " 间"},
                {"物业面积", numberText(version.input().propertyAreaSqm()) + " ㎡", "人员数量", version.input().staffCount() + " 人"},
                {"月租金单价", moneyText(version.input().rentPerSqmMonth()) + " 元/㎡", "月物业费单价", moneyText(version.input().propertyFeePerSqmMonth()) + " 元/㎡"},
                {"全年均价", moneyText(version.input().sellingRoomRate()) + " 元/间夜", "管理费率", percentText(version.input().managementFeeRate())},
                {"总投资金额", moneyText(version.input().investmentTotal()) + " 元", "成本参数", "COST-V" + pad(version.costParameters().versionNo())}
        };
        page.keyValueGrid(42, 687, 511, 32, overview);

        page.sectionTitle("成本参数与固定口径", "COST ASSUMPTIONS", 42, 466);
        CostParameterView cost = version.costParameters();
        BigDecimal operations = "FOUR_DIAMOND".equals(version.input().positioning())
                ? cost.fourDiamondOperationsPerRoomNight() : cost.threeDiamondOperationsPerRoomNight();
        page.table(42, 438, new double[]{185, 165, 161},
                new String[]{"参数项目", "参数值", "计量口径"},
                List.of(
                        new String[]{"人员薪资", moneyText(cost.salaryPerPersonMonth()), "元 / 人 / 月"},
                        new String[]{"易耗品", moneyText(cost.consumablesPerRoomNight()), "元 / 已售间夜"},
                        new String[]{"布草洗涤", moneyText(cost.linenPerRoomNight()), "元 / 已售间夜"},
                        new String[]{"水电", moneyText(cost.utilitiesPerRoomNight()), "元 / 已售间夜"},
                        new String[]{positioningLabel(version.input().positioning()) + "运营费", moneyText(operations), "元 / 已售间夜"},
                        new String[]{"单房变动成本合计", moneyText(version.calculation().unitVariableCost()), "元 / 已售间夜"},
                        new String[]{"年固定成本合计", moneyText(version.calculation().annualFixedCost()), "元 / 年"}
                ), new boolean[]{false, true, false}, 25);

        page.callout(42, 72, 511, 112, "测算说明",
                "年收入＝房间数×365×出租率×全年均价；年管理费＝年收入×管理费率；年利润＝年收入－年成本－年管理费。"
                        + "本模型用于经营利润与静态投资回收预测，不包含融资、税费、折旧、残值、租金递增、免租期及装修停业期。",
                version.calculation().warnings().isEmpty() ? null
                        : "复核提示：" + version.calculation().warnings().stream()
                        .map(item -> item.message()).reduce((a, b) -> a + "；" + b).orElse(""));
        return page.content();
    }

    private static String comparisonPdfPage(
            String projectNo,
            InvestmentVersionView version,
            List<ScenarioResult> scenarios,
            int pageNo,
            int totalPages
    ) {
        PdfCanvas page = new PdfCanvas();
        page.standardPage("02", "多情景投资回报预测", projectNo, version, pageNo, totalPages);
        ScenarioResult representative = representativeScenario(scenarios);
        page.metricStrip(42, 626, 511, List.of(
                new Metric("全年均价", moneyText(version.input().sellingRoomRate()) + " 元"),
                new Metric("总投资金额", amountWanText(version.input().investmentTotal()) + " 万元"),
                new Metric("年固定成本", amountWanText(version.calculation().annualFixedCost()) + " 万元"),
                new Metric("盈亏平衡出租率", version.calculation().breakEvenOccupancyRate() == null
                        ? "无法形成" : percentText(version.calculation().breakEvenOccupancyRate()))
        ));

        page.sectionTitle("经营预测", "OPERATING FORECAST", 42, 592);
        List<String[]> operations = scenarios.stream().map(item -> new String[]{
                percentText(item.occupancyRate()), moneyText(version.input().sellingRoomRate()), numberText(item.soldRoomNights()),
                amountWanText(item.annualRevenue()), amountWanText(item.annualCost()), amountWanText(item.annualManagementFee())
        }).toList();
        page.table(42, 567, new double[]{67, 76, 87, 93, 93, 95},
                new String[]{"出租率", "全年均价", "年开房量", "年收入/万", "年成本/万", "年管理费/万"},
                operations, new boolean[]{false, true, true, true, true, true}, 24);

        double returnTitleY = 567 - (scenarios.size() + 1) * 24 - 30;
        page.sectionTitle("投资回报", "RETURN ANALYSIS", 42, returnTitleY);
        List<String[]> returns = scenarios.stream().map(item -> new String[]{
                percentText(item.occupancyRate()), amountWanText(version.input().investmentTotal()), amountWanText(item.annualProfit()),
                percentText(item.investmentReturnRate()), item.paybackYears() == null ? "无法回收" : numberText(item.paybackYears()) + " 年",
                ratingLabel(item.rating())
        }).toList();
        double returnTableTop = returnTitleY - 25;
        page.table(42, returnTableTop, new double[]{67, 105, 100, 79, 82, 78},
                new String[]{"出租率", "总投资/万", "年利润/万", "回报率", "回收时长", "判定"},
                returns, new boolean[]{false, true, true, true, true, false}, 24);

        double chartTitleY = returnTableTop - (scenarios.size() + 1) * 24 - 30;
        page.sectionTitle("年利润趋势", "ANNUAL PROFIT", 42, chartTitleY);
        BigDecimal maxProfit = scenarios.stream().map(item -> item.annualProfit().max(BigDecimal.ZERO))
                .max(BigDecimal::compareTo).orElse(BigDecimal.ONE);
        double barY = chartTitleY - 28;
        for (ScenarioResult scenario : scenarios) {
            page.horizontalBar(percentText(scenario.occupancyRate()), scenario.annualProfit().max(BigDecimal.ZERO),
                    maxProfit, 42, barY, 400, MID_GREEN, amountWanText(scenario.annualProfit()) + " 万元");
            barY -= 23;
        }

        String conclusion = "以" + percentText(representative.occupancyRate()) + "出租率作为所选情景中的主参照：预计年收入"
                + moneyText(representative.annualRevenue()) + "元，年利润" + moneyText(representative.annualProfit())
                + "元，静态回收期" + (representative.paybackYears() == null ? "无法形成" : numberText(representative.paybackYears()) + "年")
                + "，综合判定为“" + ratingLabel(representative.rating()) + "”。";
        page.callout(42, 55, 511, 68, "综合预测结论", conclusion, null);
        return page.content();
    }

    private static String scenarioPdfPage(
            String projectNo,
            InvestmentVersionView version,
            ScenarioResult scenario,
            int pageNo,
            int totalPages
    ) {
        PdfCanvas page = new PdfCanvas();
        page.standardPage(String.format(Locale.ROOT, "%02d", pageNo), percentText(scenario.occupancyRate()) + " 出租率模型",
                projectNo, version, pageNo, totalPages);

        page.fillRect(42, 610, 511, 95, DEEP_GREEN);
        page.text(percentText(scenario.occupancyRate()), 28, 62, 653, WHITE);
        page.text("出租率情景", 9, 63, 633, GOLD);
        page.text("判定", 8, 438, 668, CREAM);
        page.text(ratingLabel(scenario.rating()), 18, 438, 640, WHITE);
        page.text("全年均价 " + moneyText(version.input().sellingRoomRate()) + " 元/间夜  ·  总投资 "
                + amountWanText(version.input().investmentTotal()) + " 万元", 8, 62, 622, CREAM);

        page.metricStrip(42, 514, 511, List.of(
                new Metric("年营业收入", amountWanText(scenario.annualRevenue()) + " 万元"),
                new Metric("年成本", amountWanText(scenario.annualCost()) + " 万元"),
                new Metric("年利润", amountWanText(scenario.annualProfit()) + " 万元"),
                new Metric("静态回收期", scenario.paybackYears() == null ? "无法回收" : numberText(scenario.paybackYears()) + " 年")
        ));

        page.sectionTitle("年度与月均经营结果", "YEAR / MONTH", 42, 480);
        page.table(42, 455, new double[]{191, 160, 160},
                new String[]{"指标", "年度", "月均"},
                List.of(
                        new String[]{"营业收入", moneyText(scenario.annualRevenue()) + "元", moneyText(scenario.monthlyRevenue()) + "元"},
                        new String[]{"成本（不含管理费）", moneyText(scenario.annualCost()) + "元", moneyText(scenario.monthlyCost()) + "元"},
                        new String[]{"管理费", moneyText(scenario.annualManagementFee()) + "元", moneyText(scenario.monthlyManagementFee()) + "元"},
                        new String[]{"利润", moneyText(scenario.annualProfit()) + "元", moneyText(scenario.monthlyProfit()) + "元"}
                ), new boolean[]{false, true, true}, 27);

        page.sectionTitle("经营规模与成本构成", "OPERATING SCALE & COST", 42, 305);
        BigDecimal maxCost = scenario.annualCost().max(BigDecimal.ONE);
        page.horizontalBar("物业", scenario.annualPropertyCost(), maxCost, 42, 272, 330, MID_GREEN,
                amountWanText(scenario.annualPropertyCost()) + " 万元");
        page.horizontalBar("人工", scenario.annualLaborCost(), maxCost, 42, 247, 330, GOLD,
                amountWanText(scenario.annualLaborCost()) + " 万元");
        page.horizontalBar("变动", scenario.annualVariableCost(), maxCost, 42, 222, 330, new PdfColor(0.360, 0.520, 0.470),
                amountWanText(scenario.annualVariableCost()) + " 万元");
        page.horizontalBar("管理费", scenario.annualManagementFee(), maxCost, 42, 197, 330, new PdfColor(0.675, 0.545, 0.300),
                amountWanText(scenario.annualManagementFee()) + " 万元");
        page.text("年可售间夜 " + numberText(scenario.availableRoomNights()) + "  ·  年开房量 "
                + numberText(scenario.soldRoomNights()) + "  ·  月均开房量 " + numberText(scenario.monthlySoldRoomNights()),
                8, 42, 174, MUTED);

        String narrative = "在" + percentText(scenario.occupancyRate()) + "出租率下，按全年均价"
                + moneyText(version.input().sellingRoomRate()) + "元测算，预计年收入" + moneyText(scenario.annualRevenue())
                + "元；扣除年成本" + moneyText(scenario.annualCost()) + "元及管理费"
                + moneyText(scenario.annualManagementFee()) + "元后，预计年利润" + moneyText(scenario.annualProfit())
                + "元，投资回报率" + percentText(scenario.investmentReturnRate()) + "，"
                + (scenario.paybackYears() == null ? "当前条件下无法形成有效回收期。" : "静态回收期约" + numberText(scenario.paybackYears()) + "年。")
                + "本预测不包含融资、税费、折旧、残值、租金递增、免租期及装修停业期。";
        page.callout(42, 55, 511, 100, "情景分析", narrative, null);
        return page.content();
    }

    private static ScenarioResult representativeScenario(List<ScenarioResult> scenarios) {
        return scenarios.stream().filter(item -> item.occupancyRate().compareTo(new BigDecimal("0.85")) == 0)
                .findFirst().orElse(scenarios.getFirst());
    }

    private static void put(ZipOutputStream zip, String name, String content) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(ZIP_ENTRY_TIME);
        zip.putNextEntry(entry);
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private static byte[] bytes(String value) {
        return value.getBytes(StandardCharsets.ISO_8859_1);
    }

    private static byte[] join(byte[]... parts) {
        int length = 0;
        for (byte[] part : parts) length += part.length;
        byte[] result = new byte[length];
        int offset = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, result, offset, part.length);
            offset += part.length;
        }
        return result;
    }

    private static String pdfHex(String value) {
        return HexFormat.of().formatHex(value.getBytes(StandardCharsets.UTF_16BE)).toUpperCase(Locale.ROOT);
    }

    private static String safeText(String value) {
        if (value == null) return "";
        String cleaned = value.replace("\u0000", "");
        String trimmed = cleaned.stripLeading();
        if (!trimmed.isEmpty() && "=+-@".indexOf(trimmed.charAt(0)) >= 0) return "'" + cleaned;
        return cleaned.length() > 32767 ? cleaned.substring(0, 32750) + "...[截断]" : cleaned;
    }

    private static String xmlText(String value) {
        if (value == null) return "";
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static String excelColumn(int oneBased) {
        StringBuilder result = new StringBuilder();
        int column = oneBased;
        while (column > 0) {
            column--;
            result.append((char) ('A' + column % 26));
            column /= 26;
        }
        return result.reverse().toString();
    }

    private static List<Cell> row(Cell... cells) {
        return List.of(cells);
    }

    static String moneyText(BigDecimal value) {
        return value == null ? "—" : value.stripTrailingZeros().toPlainString();
    }

    private static String amountWanText(BigDecimal value) {
        return value == null ? "—" : moneyText(value.divide(BigDecimal.valueOf(10_000), 2, RoundingMode.HALF_UP));
    }

    static String numberText(BigDecimal value) {
        return value == null ? "—" : value.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }

    static String percentText(BigDecimal value) {
        return value == null ? "—" : value.multiply(BigDecimal.valueOf(100)).setScale(2, RoundingMode.HALF_UP)
                .stripTrailingZeros().toPlainString() + "%";
    }

    private static String versionLabel(InvestmentVersionView version) {
        return "V" + pad(version.versionNo()) + " · " + statusLabel(version.lifecycleStatus());
    }

    private static String pad(int value) {
        return String.format(Locale.ROOT, "%03d", value);
    }

    private static String positioningLabel(String value) {
        return "FOUR_DIAMOND".equals(value) ? "四钻" : "三钻";
    }

    private static String ratingLabel(String value) {
        return InvestmentCalculationEngine.ratingLabel(value);
    }

    private static String statusLabel(String value) {
        return switch (value) {
            case "DRAFT" -> "草稿";
            case "FORMAL" -> "正式预测";
            case "HISTORICAL" -> "历史版本";
            case "ACTIVE" -> "生效";
            case "RETIRED" -> "已停用";
            case "ARCHIVED" -> "已归档";
            default -> value;
        };
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private record Metric(String label, String value) {
    }

    private record PdfColor(double red, double green, double blue) {
    }

    private enum FontRole { TITLE, BODY, BOLD }

    private record FontSet(
            PDFont serif,
            PDFont sans,
            PDFont bold,
            TrueTypeCollection serifCollection,
            TrueTypeCollection sansCollection,
            TrueTypeCollection boldCollection
    ) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            serifCollection.close();
            sansCollection.close();
            boldCollection.close();
        }
    }

    private record Cell(String value, boolean numeric, int style) {
        static Cell empty() { return text(""); }
        static Cell text(Object value) { return new Cell(value == null ? "" : String.valueOf(value), false, 0); }
        static Cell header(String value) { return new Cell(value, false, 1); }
        static Cell section(String value) { return new Cell(value, false, 2); }
        static Cell money(Object value) { return new Cell(value == null ? "" : String.valueOf(value), true, 3); }
        static Cell percent(Object value) { return new Cell(value == null ? "" : String.valueOf(value), true, 4); }
        static Cell number(Object value) { return new Cell(value == null ? "" : String.valueOf(value), true, 5); }
    }

    private static final class PdfCanvas {
        private final StringBuilder content = new StringBuilder(24_000);

        private void fillPage(PdfColor color) {
            fillRect(0, 0, 595, 842, color);
        }

        private void standardPage(
                String section,
                String title,
                String projectNo,
                InvestmentVersionView version,
                int pageNo,
                int totalPages
        ) {
            fillPage(PAPER);
            fillRect(0, 802, 595, 40, DEEP_GREEN);
            text("四方馆酒店 AI OS · 投资分析", 9, 42, 817, WHITE, FontRole.BOLD);
            rightText("内部经营资料", 8, 553, 817, CREAM);
            fillRect(42, 770, 34, 3, GOLD);
            text(section + "  " + title, 22, 42, 738, DEEP_GREEN, FontRole.TITLE);
            text(version.projectName() + "  ·  " + projectNo + "  ·  " + versionLabel(version), 8, 43, 715, MUTED);
            text("FORMAL".equals(version.lifecycleStatus()) ? "正式预测" : "非正式测算", 40, 184, 410,
                    new PdfColor(0.948, 0.944, 0.918));
            strokeLine(42, 39, 553, 39, GRID, 0.5);
            text("数据来源：投资测算确定性模型", 7, 42, 23, MUTED);
            rightText("第 " + pageNo + " / " + totalPages + " 页", 7, 553, 23, MUTED);
        }

        private void metricCard(double x, double y, double width, double height, String label, String value, String unit, PdfColor accent) {
            fillRect(x, y, width, height, MID_GREEN);
            fillRect(x, y + height - 4, width, 4, accent);
            text(label, 9, x + 17, y + height - 25, CREAM, FontRole.BOLD);
            text(value, value.length() > 12 ? 15 : 19, x + 17, y + 32, WHITE, FontRole.BOLD);
            if (hasText(unit)) rightText(unit, 8, x + width - 17, y + 16, accent);
        }

        private void metricStrip(double x, double y, double width, List<Metric> metrics) {
            double gap = 8;
            double cardWidth = (width - gap * (metrics.size() - 1)) / metrics.size();
            for (int index = 0; index < metrics.size(); index++) {
                double cardX = x + index * (cardWidth + gap);
                fillRect(cardX, y, cardWidth, 66, index == 0 ? SOFT_GREEN : CREAM);
                fillRect(cardX, y + 62, cardWidth, 4, index == 0 ? MID_GREEN : GOLD);
                text(metrics.get(index).label(), 7, cardX + 10, y + 43, MUTED);
                String value = metrics.get(index).value();
                text(value, value.length() > 15 ? 10 : 12, cardX + 10, y + 19, DEEP_GREEN, FontRole.BOLD);
            }
        }

        private void sectionTitle(String title, String english, double x, double y) {
            text(title, 14, x, y, DEEP_GREEN, FontRole.TITLE);
            rightText(english, 7, 553, y + 1, GOLD);
            strokeLine(x, y - 8, 553, y - 8, GRID, 0.5);
        }

        private void keyValueGrid(double x, double topY, double width, double rowHeight, String[][] rows) {
            double half = width / 2;
            double labelWidth = 76;
            for (int row = 0; row < rows.length; row++) {
                double bottom = topY - (row + 1) * rowHeight;
                if (row % 2 == 0) fillRect(x, bottom, width, rowHeight, CREAM);
                strokeLine(x, bottom, x + width, bottom, GRID, 0.45);
                text(rows[row][0], 8, x + 10, bottom + 11, MUTED);
                text(rows[row][1], rows[row][1].length() > 19 ? 7 : 9, x + labelWidth, bottom + 11, INK);
                text(rows[row][2], 8, x + half + 10, bottom + 11, MUTED);
                text(rows[row][3], rows[row][3].length() > 19 ? 7 : 9, x + half + labelWidth, bottom + 11, INK);
            }
            strokeRect(x, topY - rows.length * rowHeight, width, rows.length * rowHeight, GRID, 0.5);
            strokeLine(x + half, topY - rows.length * rowHeight, x + half, topY, GRID, 0.45);
        }

        private void table(
                double x,
                double topY,
                double[] widths,
                String[] headers,
                List<String[]> rows,
                boolean[] rightAligned,
                double rowHeight
        ) {
            double width = 0;
            for (double item : widths) width += item;
            fillRect(x, topY - rowHeight, width, rowHeight, DEEP_GREEN);
            double cursor = x;
            for (int column = 0; column < headers.length; column++) {
                double textY = topY - rowHeight + 8.5;
                if (rightAligned[column]) rightText(headers[column], 7.5, cursor + widths[column] - 7, textY, WHITE, FontRole.BOLD);
                else text(headers[column], 7.5, cursor + 7, textY, WHITE, FontRole.BOLD);
                cursor += widths[column];
            }

            for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
                double bottom = topY - (rowIndex + 2) * rowHeight;
                if (rowIndex % 2 == 0) fillRect(x, bottom, width, rowHeight, CREAM);
                cursor = x;
                String[] row = rows.get(rowIndex);
                for (int column = 0; column < headers.length; column++) {
                    String value = column < row.length ? row[column] : "";
                    double textY = bottom + 8.5;
                    double size = value.length() > 17 ? 7 : 8.5;
                    if (rightAligned[column]) rightText(value, size, cursor + widths[column] - 7, textY, INK);
                    else text(value, size, cursor + 7, textY, INK);
                    cursor += widths[column];
                }
                strokeLine(x, bottom, x + width, bottom, GRID, 0.4);
            }
            strokeRect(x, topY - (rows.size() + 1) * rowHeight, width, (rows.size() + 1) * rowHeight, GRID, 0.5);
        }

        private void horizontalBar(
                String label,
                BigDecimal value,
                BigDecimal max,
                double x,
                double y,
                double width,
                PdfColor color,
                String displayValue
        ) {
            text(label, 8, x, y + 2, MUTED);
            double barX = x + 55;
            double barWidth = width - 55;
            fillRect(barX, y, barWidth, 9, SOFT_GREEN);
            double ratio = max == null || max.signum() <= 0 ? 0 : value.max(BigDecimal.ZERO)
                    .divide(max, 8, RoundingMode.HALF_UP).doubleValue();
            fillRect(barX, y, Math.max(2, barWidth * Math.min(1, ratio)), 9, color);
            text(displayValue, 8, x + width + 12, y + 1, INK);
        }

        private void callout(double x, double y, double width, double height, String title, String body, String note) {
            fillRect(x, y, width, height, CREAM);
            fillRect(x, y, 4, height, GOLD);
            text(title, 11, x + 18, y + height - 24, DEEP_GREEN, FontRole.BOLD);
            wrapped(body, 9.5, x + 18, y + height - 43, 55, 15, note == null ? 4 : 3, INK);
            if (hasText(note)) text(clip(note, 61), 7, x + 18, y + 13, RISK);
        }

        private void wrapped(
                String value,
                double size,
                double x,
                double y,
                int maxUnits,
                double lineHeight,
                int maxLines,
                PdfColor color
        ) {
            List<String> lines = wrapLines(value, maxUnits);
            for (int index = 0; index < Math.min(maxLines, lines.size()); index++) {
                String line = lines.get(index);
                if (index == maxLines - 1 && lines.size() > maxLines) line = clip(line, Math.max(1, line.length() - 1)) + "…";
                text(line, size, x, y - index * lineHeight, color);
            }
        }

        private List<String> wrapLines(String value, int maxUnits) {
            List<String> lines = new ArrayList<>();
            if (value == null || value.isBlank()) return lines;
            StringBuilder line = new StringBuilder();
            double units = 0;
            for (int index = 0; index < value.length(); index++) {
                char character = value.charAt(index);
                if (character == '\n') {
                    if (!line.isEmpty()) lines.add(line.toString());
                    line.setLength(0);
                    units = 0;
                    continue;
                }
                double weight = 1;
                if (units + weight > maxUnits && !line.isEmpty()) {
                    String carry = "";
                    if (isNumericTokenCharacter(character)) {
                        int tokenStart = line.length();
                        while (tokenStart > 0 && isNumericTokenCharacter(line.charAt(tokenStart - 1))) tokenStart--;
                        if (tokenStart > 0 && tokenStart < line.length()) {
                            carry = line.substring(tokenStart);
                            line.setLength(tokenStart);
                        }
                    }
                    lines.add(line.toString());
                    line.setLength(0);
                    line.append(carry);
                    units = carry.length();
                }
                line.append(character);
                units += weight;
            }
            if (!line.isEmpty()) lines.add(line.toString());
            return lines;
        }

        private boolean isNumericTokenCharacter(char character) {
            return Character.isDigit(character)
                    || character == '.'
                    || character == '%'
                    || character == '-'
                    || character == '元'
                    || character == '年';
        }

        private String clip(String value, int length) {
            if (value == null || value.length() <= length) return value == null ? "" : value;
            return value.substring(0, Math.max(1, length - 1)) + "…";
        }

        private void fillRect(double x, double y, double width, double height, PdfColor color) {
            content.append(String.format(Locale.ROOT, "RECT|%.2f|%.2f|%.2f|%.2f|%.3f|%.3f|%.3f\n",
                    x, y, width, height, color.red(), color.green(), color.blue()));
        }

        private void strokeRect(double x, double y, double width, double height, PdfColor color, double lineWidth) {
            content.append(String.format(Locale.ROOT, "STROKERECT|%.2f|%.2f|%.2f|%.2f|%.3f|%.3f|%.3f|%.2f\n",
                    x, y, width, height, color.red(), color.green(), color.blue(), lineWidth));
        }

        private void strokeLine(double x1, double y1, double x2, double y2, PdfColor color, double lineWidth) {
            content.append(String.format(Locale.ROOT, "LINE|%.2f|%.2f|%.2f|%.2f|%.3f|%.3f|%.3f|%.2f\n",
                    x1, y1, x2, y2, color.red(), color.green(), color.blue(), lineWidth));
        }

        private void text(String value, double size, double x, double y, PdfColor color) {
            text(value, size, x, y, color, FontRole.BODY);
        }

        private void text(String value, double size, double x, double y, PdfColor color, FontRole role) {
            content.append(String.format(Locale.ROOT, "TEXT|%.2f|%.2f|%.2f|%s|%.3f|%.3f|%.3f|%s\n",
                    size, x, y, escapeText(value == null ? "" : value), color.red(), color.green(), color.blue(), role));
        }

        private void rightText(String value, double size, double rightX, double y, PdfColor color) {
            text(value, size, rightX - estimatedWidth(value, size), y, color);
        }

        private void rightText(String value, double size, double rightX, double y, PdfColor color, FontRole role) {
            text(value, size, rightX - estimatedWidth(value, size), y, color, role);
        }

        private double estimatedWidth(String value, double size) {
            if (value == null) return 0;
            double units = 0;
            for (int index = 0; index < value.length(); index++) units += value.charAt(index) <= 127 ? 0.55 : 1;
            return units * size;
        }

        private String content() {
            return content.toString();
        }
    }
}
