package cn.sifangguan.hotelaios.investment;

import org.apache.fontbox.ttf.TrueTypeCollection;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.springframework.stereotype.Component;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalCalculationResult;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalMaintenanceUpgrade;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalPlanInput;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalReportNarrative;
import static cn.sifangguan.hotelaios.investment.ProfessionalInvestmentModels.ProfessionalYearlyResult;

/** Renders the investor-facing professional report in the forest-green/gold visual system. */
@Component
public class ProfessionalInvestmentReportRenderer {
    private static final PdfColor DEEP_GREEN = new PdfColor(14, 66, 54);
    private static final PdfColor MID_GREEN = new PdfColor(25, 102, 80);
    private static final PdfColor SOFT_GREEN = new PdfColor(229, 240, 232);
    private static final PdfColor GOLD = new PdfColor(197, 154, 73);
    private static final PdfColor CREAM = new PdfColor(248, 243, 230);
    private static final PdfColor PAPER = new PdfColor(253, 251, 246);
    private static final PdfColor INK = new PdfColor(29, 45, 38);
    private static final PdfColor MUTED = new PdfColor(91, 108, 99);
    private static final PdfColor GRID = new PdfColor(204, 214, 205);
    private static final PdfColor WHITE = new PdfColor(255, 255, 255);
    private static final PdfColor RISK = new PdfColor(159, 76, 53);

    public byte[] render(ProfessionalPlanInput input, ProfessionalCalculationResult result) {
        try (PDDocument document = new PDDocument();
             FontSet fonts = loadFonts(document);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            ReportContext context = reportContext(input);
            cover(document, fonts, input, result);
            oneMinuteSummary(document, fonts, input, result, context, 2, 11);
            projectOverview(document, fonts, input, result, context, 3, 11);
            capitalAndEfficiency(document, fonts, input, result, context, 4, 11);
            advantagesAndValidation(document, fonts, input, result, context, 5, 11);
            upgradeAndProductStrategy(document, fonts, input, result, context, 6, 11);
            operatingAssumptions(document, fonts, input, result, 7, 11);
            yearlyCashFlow(document, fonts, input, result, 8, 11);
            returnsAndRisks(document, fonts, input, result, context, 9, 11);
            cooperationAndExit(document, fonts, input, result, context, 10, 11);
            dataScope(document, fonts, input, result, context, 11, 11);
            document.save(output);
            return output.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("无法生成投资测算专业版 PDF", exception);
        }
    }

    private void cover(PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result) throws IOException {
        page(document, fonts, canvas -> {
            canvas.fillPage(DEEP_GREEN);
            canvas.fillRect(50, 770, 86, 4, GOLD);
            canvas.text("SIFANGGUAN HOTEL GROUP", 9, 50, 744, GOLD, FontRole.BOLD);
            canvas.text("酒店投资分析书", 32, 50, 666, WHITE, FontRole.TITLE);
            canvas.text("INVESTMENT ANALYSIS PROFESSIONAL", 10, 52, 637, GOLD, FontRole.BOLD);
            canvas.text(safe(input.projectName()), 18, 50, 585, WHITE, FontRole.TITLE);
            canvas.line(50, 560, 545, 560, GOLD, 0.8);
            canvas.text("专业版模型 - 多年度 ADR / 经营现金流 / IRR 与 NPV", 9, 50, 535, CREAM);

            canvas.metric(50, 393, 237, 94, "首期综合投入", wan(resultValue(input.initialInvestment())), "万元", GOLD);
            canvas.metric(308, 393, 237, 94, "全周期 IRR", percent(result.irr()), "内部收益率", GOLD);
            canvas.metric(50, 281, 237, 94, "投资回收期", result.paybackYears() == null ? "未回收" : number(result.paybackYears()), "年", SOFT_GREEN);
            canvas.metric(308, 281, 237, 94, "入住率", percent(input.occupancyRate()), "全年均值", SOFT_GREEN);

            canvas.fillRect(50, 108, 495, 128, CREAM);
            canvas.fillRect(50, 108, 5, 128, GOLD);
            canvas.text("测算亮点", 11, 72, 206, DEEP_GREEN, FontRole.BOLD);
            canvas.wrap("以 " + input.roomCount() + " 间客房、" + percent(input.occupancyRate())
                            + " 入住率及完整租期现金流为基础，专业版将年度 ADR、管理费、维护升级、首期预付租金及押金回收统一纳入同一口径。",
                    10, 72, 181, 47, 17, 4, INK);
            canvas.text("本报告由系统根据项目填写数据自动生成；收益为测算结果，不构成承诺。", 8, 50, 55, CREAM);
            canvas.right("第 1 / 11 页", 8, 545, 55, CREAM);
        });
    }

    private void oneMinuteSummary(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("01", "项目一分钟投资摘要", input, pageNo, totalPages);
            canvas.callout(52, 592, 491, 92, "项目结论与定位",
                    "项目位于" + blankAsDash(input.projectLocation()) + "，以" + wan(input.initialInvestment())
                            + "万元完成整体接手、租赁资金安排及升级改造。" + context.marketContext(),
                    "本报告用于项目沟通与投资决策，不构成保本或固定收益承诺。");
            canvas.metricStrip(52, 492, 491, List.of(
                    new Metric("首期综合投入", wan(input.initialInvestment()) + " 万元", "项目整体启动资金"),
                    new Metric("基准入住率", percent(input.occupancyRate()), "全年平均口径"),
                    new Metric("首年 ADR", money(result.yearlyResults().getFirst().adr()) + " 元", "全年平均房价"),
                    new Metric("投资回收期", result.paybackYears() == null ? "未回收" : number(result.paybackYears()) + " 年", "按年度现金流")
            ));
            canvas.section("核心指标", "KEY METRICS", 52, 448);
            canvas.keyValue(52, 420, 491, 38, new String[][]{
                    {"客房数量", input.roomCount() + " 间", "经营周期", input.leaseTermYears() + " 年"},
                    {"12 年累计收入", wan(result.totalRevenue()) + " 万元", "12 年累计净现金收益", wan(result.netCashGain()) + " 万元"},
                    {"IRR", percent(result.irr()), "NPV", wan(result.npv()) + " 万元"},
                    {"ROI", percent(result.roi()), "管理费率", percent(input.managementFeeRate())}
            });
            canvas.section("核心投资价值", "INVESTMENT VALUE", 52, 244);
            canvas.callout(52, 129, 491, 92, "成熟需求与低成本基础",
                    "“成熟商圈、长期租赁、产品升级、集团运营”共同构成项目现金流基础。"
                            + "首期投入按整体口径管理，预付租金与押金均已纳入现金流核对。",
                    "收益与风险应结合后续尽调、工程预算、租赁条款及正式投资协议综合判断。");
            canvas.text("投资亮点：在营项目接手快 · 低成本租赁锁定期 · 品牌与运营体系导入 · 可按年度复投维护", 8.5, 52, 91, MID_GREEN, FontRole.BOLD);
        });
    }

    private void projectOverview(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("02", "项目概况与投资结构", input, pageNo, totalPages);
            canvas.section("项目基础信息", "PROJECT PROFILE", 52, 668);
            canvas.keyValue(52, 640, 491, 44, new String[][]{
                    {"项目名称", safe(input.projectName()), "项目地点", blankAsDash(input.projectLocation())},
                    {"项目状态", summaryText(context.projectStatus(), 32), "项目类型", "在营酒店整体接手及升级"},
                    {"客房规模", input.roomCount() + " 间", "经营面积", number(input.propertyAreaSqm()) + " ㎡"},
                    {"租赁年限", input.leaseTermYears() + " 年", "导入品牌", blankAsDash(input.brandName())},
                    {"运营主体", blankAsDash(input.operatorName()), "项目定位", summaryText(context.productPositioning(), 32)}
            });
            canvas.section("项目投资标的", "INVESTMENT TARGET", 52, 408);
            canvas.callout(52, 274, 491, 106, "存量酒店升级价值",
                    "项目为已具备物业、客房及基础经营条件的在营酒店。整体接手后，通过产品升级、品牌转换及运营优化，"
                            + "在保留既有商圈客源基础的同时提升经营效率与产品竞争力。",
                    "项目当前状态：" + context.projectStatus());
            canvas.section("投资范围", "INVESTMENT SCOPE", 52, 232);
            canvas.callout(52, 104, 491, 96, "首期综合投入的统一口径",
                    "首期综合投入覆盖项目整体收购、交易居间、房屋租赁（预付租金）及押金、升级改造等启动事项。"
                            + "报告按统一资金口径呈现，不将同一笔首期投入重复计入多个方向。",
                    "首期预付租金 " + wan(result.quarterlyRentAndPropertyCost()) + " 万元；履约押金 " + wan(result.leaseDeposit()) + " 万元。" );
        });
    }

    private void capitalAndEfficiency(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("03", "资金结构与投资效率", input, pageNo, totalPages);
            canvas.section("资金使用方向", "INITIAL INVESTMENT", 52, 668);
            canvas.table(52, 638, new double[]{210, 95, 186}, new String[]{"投资方向", "投资金额", "主要用途"}, List.of(
                    new String[]{"整体收购、租赁费用及押金、升级改造", wan(input.initialInvestment()) + " 万元", "完成项目接手、交易落地与产品升级"},
                    new String[]{"合计", wan(input.initialInvestment()) + " 万元", "项目整体启动投入"}
            ), new boolean[]{false, true, false}, 34, 8);
            canvas.callout(52, 402, 491, 104, "租赁资金核对",
                    "租赁面积、月租金、预付月数及押金月数均已进入现金流模型。履约押金属于合同保障资金，"
                            + "其返还安排以租赁合同约定为准。",
                    "全年租金及物业费 " + wan(result.annualRentAndPropertyCost()) + " 万元；预付 " + number(input.prepaidRentMonths()) + " 个月；押金 " + number(input.depositMonths()) + " 个月。" );
            canvas.section("单位客房投资效率", "UNIT INVESTMENT EFFICIENCY", 52, 370);
            BigDecimal perRoom = input.initialInvestment().divide(BigDecimal.valueOf(input.roomCount()), 2, RoundingMode.HALF_UP);
            BigDecimal benchmarkPerRoom = context.sameScaleNewHotelInvestment().divide(BigDecimal.valueOf(input.roomCount()), 2, RoundingMode.HALF_UP);
            BigDecimal relativeCost = input.initialInvestment().divide(context.sameScaleNewHotelInvestment(), 4, RoundingMode.HALF_UP);
            canvas.table(52, 340, new double[]{170, 150, 171}, new String[]{"指标", "本项目", "同规模新店参考"}, List.of(
                    new String[]{"客房数量", input.roomCount() + " 间", input.roomCount() + " 间"},
                    new String[]{"总投资", wan(input.initialInvestment()) + " 万元", wan(context.sameScaleNewHotelInvestment()) + " 万元"},
                    new String[]{"单房投资成本", wan(perRoom) + " 万元/间", wan(benchmarkPerRoom) + " 万元/间"},
                    new String[]{"投资关系", percent(relativeCost), "本项目的 " + number(BigDecimal.ONE.divide(relativeCost, 2, RoundingMode.HALF_UP)) + " 倍"}
            ), new boolean[]{false, true, true}, 30, 8);
            canvas.callout(52, 58, 491, 108, "资金效率说明",
                    "通过接手现有经营基础并进行针对性升级，项目可减少从零筹建、市场培育及全套工程投入。"
                            + "同规模新店参考投入仅作为效率对比，应按当地建设标准与实际报价复核。",
                    "参考投入可在“投资沟通与经营验证”中修改，不影响核心测算。" );
        });
    }

    private void advantagesAndValidation(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("04", "项目优势与经营验证", input, pageNo, totalPages);
            canvas.section("成熟商圈与经营基础", "MARKET FOUNDATION", 52, 668);
            canvas.callout(52, 548, 491, 92, "可验证的需求基础", context.marketContext(),
                    "项目状态：" + context.projectStatus());
            canvas.section("长期租赁成本优势", "LEASE ADVANTAGE", 52, 505);
            BigDecimal actualUnitRent = input.rentPerSqmMonth().add(input.propertyFeePerSqmMonth());
            BigDecimal marketLowAnnual = context.marketRentLow().multiply(input.propertyAreaSqm()).multiply(BigDecimal.valueOf(12));
            BigDecimal marketHighAnnual = context.marketRentHigh().multiply(input.propertyAreaSqm()).multiply(BigDecimal.valueOf(12));
            canvas.table(52, 476, new double[]{174, 160, 157}, new String[]{"指标", "本项目", "周边市场参考"}, List.of(
                    new String[]{"租金单价（含物业费）", money(actualUnitRent) + " 元/㎡/月", money(context.marketRentLow()) + " - " + money(context.marketRentHigh()) + " 元/㎡/月"},
                    new String[]{"年租赁成本", wan(result.annualRentAndPropertyCost()) + " 万元", wan(marketLowAnnual) + " - " + wan(marketHighAnnual) + " 万元"},
                    new String[]{"年成本优势", wan(marketLowAnnual.subtract(result.annualRentAndPropertyCost())) + " - " + wan(marketHighAnnual.subtract(result.annualRentAndPropertyCost())) + " 万元", "按同面积静态比较"},
                    new String[]{"租赁年限", input.leaseTermYears() + " 年", "以市场及合同条件为准"}
            ), new boolean[]{false, true, true}, 31, 7.8);
            canvas.section("本地运营验证", "OPERATING EVIDENCE", 52, 294);
            canvas.metricStrip(52, 190, 491, List.of(
                    new Metric("同商圈在营门店", context.localOperatingHotelCount() + " 家", "已有经营样本"),
                    new Metric("基准入住率", percent(input.occupancyRate()), "稳健折算口径"),
                    new Metric("首年 ADR", money(result.yearlyResults().getFirst().adr()) + " 元", "区域价格能力"),
                    new Metric("统一管理费", percent(input.managementFeeRate()), "已纳入测算")
            ));
            canvas.callout(52, 66, 491, 100, "集团化运营能力", context.operationEvidence(),
                    "运营主体：" + blankAsDash(input.operatorName()) + "。管理费已按营业收入比例纳入测算，不重复增加项目成本。" );
        });
    }

    private void upgradeAndProductStrategy(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("05", "升级改造与产品策略", input, pageNo, totalPages);
            canvas.section("升级改造策略", "UPGRADE STRATEGY", 52, 668);
            canvas.callout(52, 542, 491, 98, "首期改造的收益优先原则", context.upgradeStrategy(),
                    "首期升级费用已纳入首期综合投入 " + wan(input.initialInvestment()) + " 万元的统一口径。" );
            canvas.section("改造后产品定位", "PRODUCT POSITIONING", 52, 500);
            canvas.callout(52, 384, 491, 92, "目标客群与体验方向", context.productPositioning(),
                    "产品策略以稳定品质、高效商务体验及可持续价格能力为重点。" );
            canvas.section("长期维护与复投安排", "REINVESTMENT PLAN", 52, 342);
            List<String[]> upgrades = new ArrayList<>();
            upgrades.add(new String[]{"首次接手及升级", "纳入首期综合投入", "完成品牌导入、产品升级及开业准备"});
            List<ProfessionalMaintenanceUpgrade> maintenanceItems = maintenanceItems(input);
            for (ProfessionalMaintenanceUpgrade item : maintenanceItems.stream().limit(3).toList()) {
                upgrades.add(new String[]{"第 " + item.year() + " 年", wan(item.amount()) + " 万元", blankAsDash(item.purpose())});
            }
            if (maintenanceItems.size() > 3) {
                upgrades.add(new String[]{"其余 " + (maintenanceItems.size() - 3) + " 项", "已纳入年度现金流", "完整年度金额详见现金流页"});
            }
            canvas.table(52, 314, new double[]{140, 140, 211}, new String[]{"时间节点", "计划投入", "主要目的"}, upgrades,
                    new boolean[]{false, true, false}, 32, 8);
            canvas.callout(52, 48, 491, 88, "现金流管理原则",
                    "第 4 年、第 8 年等后续维护升级投入由对应年度经营现金流支出，不作为投资人追加出资。"
                            + "如市场、工程或产品条件变化，应以实际经营数据及正式预算重新测算。",
                    "维护计划随项目输入更新，并同步反映到年度利润、现金流、IRR 与 NPV。" );
        });
    }

    private void projectAndInvestment(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("01", "项目概况与投资结构", input, pageNo, totalPages);
            canvas.section("项目基础信息", "PROJECT PROFILE", 52, 667);
            canvas.keyValue(52, 638, 491, 36, new String[][]{
                    {"项目名称", safe(input.projectName()), "项目地点", blankAsDash(input.projectLocation())},
                    {"品牌/产品", blankAsDash(input.brandName()), "运营管理", blankAsDash(input.operatorName())},
                    {"客房数量", input.roomCount() + " 间", "租赁年限", input.leaseTermYears() + " 年"},
                    {"物业面积", number(input.propertyAreaSqm()) + " ㎡", "月租金", money(input.rentPerSqmMonth()) + " 元/㎡"}
            });
            canvas.section("首期资金使用口径", "INITIAL INVESTMENT", 52, 455);
            canvas.fillRect(52, 330, 491, 96, CREAM);
            canvas.fillRect(52, 330, 5, 96, GOLD);
            canvas.text("首期综合投入", 10, 74, 397, DEEP_GREEN, FontRole.BOLD);
            canvas.text(wan(input.initialInvestment()) + " 万元", 24, 74, 357, DEEP_GREEN, FontRole.TITLE);
            canvas.wrap("包含酒店收购、交易居间、房屋租赁（" + number(input.prepaidRentMonths()) + " 个月租金）及押金、升级改造等项目整体投入。资金方向按综合投入管理，不再拆分为多个投资方向。",
                    9.5, 255, 397, 33, 15, 3, INK);
            canvas.section("租赁资金核对", "LEASE CASH CHECK", 52, 286);
            canvas.metricStrip(52, 182, 491, List.of(
                    new Metric("全年租金及物业", wan(result.annualRentAndPropertyCost()) + " 万", "按面积和月单价"),
                    new Metric("首期预付租金", wan(result.quarterlyRentAndPropertyCost()) + " 万", number(input.prepaidRentMonths()) + " 个月"),
                    new Metric("履约押金", wan(result.leaseDeposit()) + " 万", number(input.depositMonths()) + " 个月")
            ));
            canvas.callout(52, 88, 491, 66, "口径说明",
                    "年度运营及固定成本由项目填写；如其中已包含全年租赁成本，首期预付租金仅在第 1 年现金流中做一次释放，避免重复计入。",
                    null);
        });
    }

    private void operatingAssumptions(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("06", "经营假设与 ADR 计划", input, pageNo, totalPages);
            canvas.metricStrip(52, 638, 491, List.of(
                    new Metric("全年入住率", percent(input.occupancyRate()), "模型输入"),
                    new Metric("年可售间夜", number(result.availableRoomNights()), "间夜"),
                    new Metric("年售出间夜", number(result.soldRoomNights()), "按入住率"),
                    new Metric("管理费率", percent(input.managementFeeRate()), "营业额比例")
            ));
            canvas.section("年度 ADR 计划", "RATE PLAN", 52, 590);
            List<String[]> adrRows = new ArrayList<>();
            for (int index = 0; index < result.yearlyResults().size(); index += 2) {
                ProfessionalYearlyResult left = result.yearlyResults().get(index);
                ProfessionalYearlyResult right = index + 1 < result.yearlyResults().size() ? result.yearlyResults().get(index + 1) : null;
                adrRows.add(new String[]{"第 " + left.year() + " 年", money(left.adr()) + " 元", right == null ? "" : "第 " + right.year() + " 年", right == null ? "" : money(right.adr()) + " 元"});
            }
            canvas.table(52, 557, new double[]{100, 145, 100, 146}, new String[]{"年度", "ADR", "年度", "ADR"}, adrRows,
                    new boolean[]{false, true, false, true}, 30, 8);
            canvas.section("维护升级计划", "PRODUCT REINVESTMENT", 52, 305);
            List<String[]> upgrades = new ArrayList<>();
            List<ProfessionalMaintenanceUpgrade> maintenanceItems = maintenanceItems(input);
            for (ProfessionalMaintenanceUpgrade item : maintenanceItems.stream().limit(4).toList()) {
                upgrades.add(new String[]{"第 " + item.year() + " 年", wan(item.amount()) + " 万元", blankAsDash(item.purpose())});
            }
            if (maintenanceItems.size() > 4) {
                upgrades.add(new String[]{"其余 " + (maintenanceItems.size() - 4) + " 项", "已纳入", "详见逐年现金流"});
            }
            if (upgrades.isEmpty()) upgrades.add(new String[]{"未设置", "-", "建议结合产品周期设置维护升级投入"});
            canvas.table(52, 272, new double[]{100, 130, 261}, new String[]{"年度", "投入金额", "用途"}, upgrades,
                    new boolean[]{false, true, false}, 29, 8);
            canvas.callout(52, 86, 491, 74, "经营安排",
                    "专业版通过逐年 ADR 反映产品价格能力的变化；管理费按每年营业收入乘以费率计取，维护升级在对应年度直接计入现金流。",
                    "年度经营利润 = 客房收入 - 年度运营及固定成本 - 管理费 - 当年维护升级。"
            );
        });
    }

    private void yearlyCashFlow(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("07", "全周期收入与现金流", input, pageNo, totalPages);
            canvas.text("以下金额单位均为万元；第 1 年现金流包含首期预付租金释放，最后一年包含押金回收。", 8, 52, 679, MUTED);
            List<String[]> rows = new ArrayList<>();
            for (ProfessionalYearlyResult item : result.yearlyResults()) {
                rows.add(new String[]{
                        String.valueOf(item.year()), money(item.adr()), wan(item.annualRevenue()), wan(item.annualManagementFee()),
                        wan(item.annualOperatingAndFixedCost()), wan(item.maintenanceUpgrade()), wan(item.annualProfit()), wan(item.cashFlow())
                });
            }
            canvas.table(52, 652, new double[]{34, 46, 70, 58, 69, 53, 73, 74},
                    new String[]{"年", "ADR", "营收", "管理费", "经营成本", "升级", "年度利润", "现金流"}, rows,
                    new boolean[]{false, true, true, true, true, true, true, true}, 24, 6.6);
            canvas.metricStrip(52, 265, 491, List.of(
                    new Metric("全周期客房收入", wan(result.totalRevenue()) + " 万", "12 年合计"),
                    new Metric("全周期管理费", wan(result.totalManagementFee()) + " 万", "营业额比例"),
                    new Metric("维护升级投入", wan(result.totalMaintenanceUpgrade()) + " 万", "计划复投"),
                    new Metric("累计经营利润", wan(result.totalAnnualProfit()) + " 万", "未含首期投资")
            ));
            canvas.callout(52, 114, 491, 98, "现金流阅读提示",
                    "年度利润用于观察单年经营质量；现金流用于测算投资回收、IRR 和 NPV。两者的差异主要来自首期预付租金与租赁押金的投入和回收时点。",
                    "所有结果均随入住率、ADR、成本、管理费率、租期和复投计划联动更新。"
            );
        });
    }

    private void returnIndicators(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("04", "投资回报指标说明", input, pageNo, totalPages);
            canvas.metricStrip(52, 632, 491, List.of(
                    new Metric("投资回收期", result.paybackYears() == null ? "未回收" : number(result.paybackYears()) + " 年", "按现金流"),
                    new Metric("IRR", percent(result.irr()), "内部收益率"),
                    new Metric("累计净现金收益", wan(result.netCashGain()) + " 万", "扣除首期投入"),
                    new Metric("ROI", percent(result.roi()), "累计净收益率")
            ));
            canvas.section("核心回报指标", "RETURN METRICS", 52, 584);
            canvas.keyValue(52, 555, 491, 38, new String[][]{
                    {"初始折现率", percent(result.discountRate()), "NPV", wan(result.npv()) + " 万元"},
                    {"首期综合投入", wan(input.initialInvestment()) + " 万元", "回收节点", result.paybackYears() == null ? "租期内未回收" : "约第 " + number(result.paybackYears()) + " 年"},
                    {"累计客房收入", wan(result.totalRevenue()) + " 万元", "累计经营利润", wan(result.totalAnnualProfit()) + " 万元"}
            });
            canvas.section("投资人通俗说明", "PLAIN LANGUAGE", 52, 386);
            canvas.callout(52, 252, 491, 106, "IRR（内部收益率）",
                    "IRR 是把项目每一年的实际现金流都考虑进去后，反映这笔投资整体年化收益水平的指标。它不是某一年固定分到手的收益率，而是全周期资金时间价值的综合结果。",
                    "本项目 IRR = " + percent(result.irr()) + "。"
            );
            canvas.callout(52, 120, 491, 106, "NPV（净现值）",
                    "NPV 是把未来每年的现金流按设定折现率换算成今天的价值，再扣除首期投资。NPV 为正，表示在该回报要求下项目仍有额外价值；数值越高，安全垫越厚。",
                    "按 " + percent(result.discountRate()) + " 折现率，NPV = " + wan(result.npv()) + " 万元。"
            );
        });
    }

    private void highlightsAndRisks(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("05", "项目亮点与风险控制", input, pageNo, totalPages);
            canvas.section("核心投资亮点", "INVESTMENT HIGHLIGHTS", 52, 668);
            canvas.callout(52, 530, 491, 104, "已纳入全周期测算",
                    "从首期综合投入到租期末，系统已统一考虑年度 ADR、全年入住率、运营及固定成本、营业额管理费、维护升级、首期预付租金与押金回收。",
                    "项目可直接复制为新方案，只需替换输入数据即可生成新报告。"
            );
            canvas.callout(52, 404, 491, 98, "可观察的经营抓手",
                    "入住率、ADR、年度成本和产品复投均为可调整变量。运营团队可依据周边竞品、渠道结构及本店实际经营表现进行动态复盘，而无需重建测算框架。",
                    "报告不展示项目方原始表格，仅展示统一计算后的结论与口径。"
            );
            canvas.section("主要风险与措施", "RISKS & RESPONSES", 52, 356);
            canvas.keyValue(52, 327, 491, 48, new String[][]{
                    {"价格风险", "中后期 ADR 可能受市场变化影响", "应对", "按年度调整 ADR，并以经营数据滚动复测"},
                    {"出租率风险", "需求波动影响售出间夜", "应对", "以渠道、会员及周边酒店经营数据校验"},
                    {"产品周期风险", "设施老化影响价格能力", "应对", "在指定年度预留维护升级投入"},
                    {"成本风险", "人工、租赁及运营成本上升", "应对", "将实际成本更新至年度运营及固定成本"}
            });
            canvas.callout(52, 60, 491, 66, "重要提示",
                    "本报告用于投资决策和沟通，不替代租赁、股权、税务、工程或法律尽调。正式交易条件、押金返还和退出安排以签署协议为准。",
                    null
            );
        });
    }

    private void cooperationAndDisclaimer(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("06", "合作安排与使用说明", input, pageNo, totalPages);
            canvas.section("投资人与运营安排", "COOPERATION", 52, 668);
            canvas.keyValue(52, 638, 491, 44, new String[][]{
                    {"投资方式", "以项目最终交易及合作协议为准", "运营主体", blankAsDash(input.operatorName())},
                    {"经营参与", "投资人不参与日常经营管理", "管理费", "营业收入 × " + percent(input.managementFeeRate())},
                    {"退出与分配", "以正式协议约定为准", "数据口径", "项目填写数据 + 系统确定性公式"}
            });
            canvas.section("使用方法", "HOW TO USE", 52, 458);
            canvas.callout(52, 333, 491, 96, "一页输入，自动成书",
                    "在“投资决策 - 投资测算 - 投资测算专业版”填写项目基础信息、租赁条件、经营成本、全年入住率、逐年 ADR 和维护升级计划，即可获得预览结果并一键导出本报告。",
                    "系统不会覆盖既有的投资项目版本。"
            );
            canvas.section("测算边界", "ASSUMPTIONS & BOUNDARIES", 52, 286);
            canvas.callout(52, 152, 491, 106, "报告阅读边界",
                    "所有金额均为模型输入和系统运算结果，未单独包含交易税费、融资成本、所得税、不可预见工程增项及协议外支出，除非项目方已将其纳入“首期综合投入”或“年度运营及固定成本”。",
                    "建议每次关键条款或经营预测变化后重新导出一版报告。"
            );
            canvas.fillRect(52, 89, 491, 35, DEEP_GREEN);
            String footerProjectName = safe(input.projectName()) + " | 投资分析书";
            canvas.text(footerProjectName, canvas.fitToWidth(footerProjectName, 10, 300, FontRole.BOLD), 70, 102, WHITE, FontRole.BOLD);
            canvas.right("统一口径 · 可复核 · 可持续更新", 8, 525, 103, GOLD);
        });
    }

    private void page(PDDocument document, FontSet fonts, PagePainter painter) throws IOException {
        PDPage page = new PDPage(PDRectangle.A4);
        document.addPage(page);
        try (PDPageContentStream content = new PDPageContentStream(document, page)) {
            painter.paint(new Canvas(content, fonts));
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
        TrueTypeFont font = collection.getFontByName(name);
        if (font == null) throw new IOException("未找到 PDF 字体：" + name);
        return font;
    }

    private static BigDecimal resultValue(BigDecimal value) {
        return value == null ? BigDecimal.ZERO : value;
    }

    private static String safe(String value) {
        if (value == null) return "";
        return value.replaceAll("[\\p{Cntrl}]", "").trim();
    }

    private static String blankAsDash(String value) {
        String cleaned = safe(value);
        return cleaned.isBlank() ? "-" : cleaned;
    }

    private static String number(BigDecimal value) {
        if (value == null) return "-";
        return value.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
    }

    private static String money(BigDecimal value) {
        return number(value);
    }

    private static String wan(BigDecimal value) {
        if (value == null) return "-";
        return number(value.divide(BigDecimal.valueOf(10_000), 2, RoundingMode.HALF_UP));
    }

    private static String percent(BigDecimal value) {
        if (value == null) return "-";
        return number(value.multiply(BigDecimal.valueOf(100))) + "%";
    }

    private void returnsAndRisks(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("08 / 09", "投资回报指标说明与风险控制", input, pageNo, totalPages);
            canvas.metricStrip(52, 632, 491, List.of(
                    new Metric("首次投资回收期", result.paybackYears() == null ? "未回收" : number(result.paybackYears()) + " 年", "按现金流计算"),
                    new Metric("IRR", percent(result.irr()), "全周期内部收益率"),
                    new Metric("累计净现金收益", wan(result.netCashGain()) + " 万元", "扣除首期投入后"),
                    new Metric("ROI", percent(result.roi()), "累计净收益率")
            ));
            canvas.section("核心回报指标", "RETURN METRICS", 52, 584);
            canvas.keyValue(52, 556, 491, 36, new String[][]{
                    {"首期综合投入", wan(input.initialInvestment()) + " 万元", "折现率", percent(result.discountRate())},
                    {"NPV", wan(result.npv()) + " 万元", "12 年累计收入", wan(result.totalRevenue()) + " 万元"},
                    {"累计经营利润", wan(result.totalAnnualProfit()) + " 万元", "维护升级投入", wan(result.totalMaintenanceUpgrade()) + " 万元"}
            });
            canvas.callout(52, 312, 491, 108, "IRR 与 NPV 的通俗解释",
                    "IRR 反映把各年资金投入和现金回收时间都考虑进去后的综合年化收益水平；NPV 是把未来现金流按设定折现率换算为今天价值后，"
                            + "扣除首期投资所剩的价值。二者不是每年固定分红，也不构成收益承诺。",
                    "本项目：IRR " + percent(result.irr()) + "；按 " + percent(result.discountRate()) + " 折现率计算，NPV " + wan(result.npv()) + " 万元。" );
            canvas.section("主要风险与应对", "RISKS & RESPONSES", 52, 270);
            canvas.table(52, 240, new double[]{116, 375}, new String[]{"风险类别", "风险控制安排"}, List.of(
                    new String[]{"市场需求波动", "根据商圈、企业协议、OTA 渠道及实际经营数据动态复盘入住率与客源结构。"},
                    new String[]{"价格竞争", "按年度维护 ADR 计划，不直接套用高溢价商圈的价格假设。"},
                    new String[]{"产品周期", "按输入的维护升级计划进行复投，保持产品竞争力与价格能力。"},
                    new String[]{"运营与成本", "由运营主体统一管理，管理费、年度经营成本及租赁成本均纳入测算口径。"}
            ), new boolean[]{false, false}, 28, 7.5);
            canvas.text("投资回报还受租赁履约、工程改造、税费、市场变化和协议条款影响，应结合尽调与正式合同确认。", 7.5, 52, 74, RISK);
        });
    }

    private void cooperationAndExit(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("10", "投资合作方式与退出机制", input, pageNo, totalPages);
            BigDecimal perShare = input.initialInvestment().divide(BigDecimal.valueOf(context.totalShares()), 2, RoundingMode.HALF_UP);
            BigDecimal minimumInvestment = perShare.multiply(BigDecimal.valueOf(context.minimumSubscriptionShares()));
            BigDecimal exitRatio = BigDecimal.ONE.subtract(BigDecimal.valueOf(context.exitStartYear()).multiply(context.annualExitDepreciationRate())).max(BigDecimal.ZERO);
            BigDecimal exitAmount = minimumInvestment.multiply(exitRatio);
            canvas.section("投资份额与认购", "SUBSCRIPTION", 52, 668);
            canvas.keyValue(52, 640, 491, 38, new String[][]{
                    {"项目总投资", wan(input.initialInvestment()) + " 万元", "项目总份额", context.totalShares() + " 股"},
                    {"每股认购金额", wan(perShare) + " 万元", "最低认购份额", context.minimumSubscriptionShares() + " 股"},
                    {"最低投资金额", wan(minimumInvestment) + " 万元", "收益分配频率", context.distributionFrequency()},
                    {"锁定期", context.lockupYears() + " 年", "可申请退出", "第 " + context.exitStartYear() + " 年起"}
            });
            canvas.section("经营管理与收益分配", "OPERATING ARRANGEMENT", 52, 420);
            canvas.callout(52, 298, 491, 98, "运营安排",
                    "投资人不参与日常经营管理，项目由" + blankAsDash(input.operatorName()) + "统一负责品牌、收益管理、OTA、人员、服务与供应链等经营事项。"
                            + "管理费按营业收入的" + percent(input.managementFeeRate()) + "计取，已纳入本报告测算。",
                    "项目原则上按 " + context.distributionFrequency() + " 进行收益分配，分配基础为实际可分配利润，并优先满足税费、日常经营和必要资金留存。" );
            canvas.section("退出机制", "EXIT MECHANISM", 52, 256);
            canvas.table(52, 226, new double[]{130, 120, 241}, new String[]{"退出年度", "本金返还比例", "每最低认购份额返还金额"}, List.<String[]>of(
                    new String[]{"第 " + context.exitStartYear() + " 年起", percent(exitRatio), wan(exitAmount) + " 万元"}
            ), new boolean[]{false, true, true}, 34, 8);
            canvas.callout(52, 48, 491, 112, "退出本金说明",
                    "示例按“原始投资金额 × [1 - 已折旧年限 × 年度折旧比例]”计算。退出本金结算不影响退出日前已取得的分红，"
                            + "受让、回购主体、办理期限、付款安排及后续退出规则均以正式投资协议为准。",
                    "示例口径：第 " + context.exitStartYear() + " 年，年度折旧比例 " + percent(context.annualExitDepreciationRate()) + "。" );
        });
    }

    private void dataScope(
            PDDocument document, FontSet fonts, ProfessionalPlanInput input, ProfessionalCalculationResult result,
            ReportContext context, int pageNo, int totalPages
    ) throws IOException {
        page(document, fonts, canvas -> {
            canvas.frame("11", "数据口径与使用说明", input, pageNo, totalPages);
            canvas.section("报告数据口径", "DATA SCOPE", 52, 668);
            canvas.callout(52, 536, 491, 104, "报告生成边界",
                    "本报告依据项目填写的客房、租赁、成本、入住率、ADR、维护升级及投资沟通资料自动生成。"
                            + "客房收入按“客房数量 × 365 天 × 入住率 × ADR”计算；管理费按营业收入比例计算。",
                    "原始项目表格和项目方内部明细不在报告中展示。" );
            canvas.section("投资沟通资料", "COMMUNICATION FACTS", 52, 492);
            canvas.keyValue(52, 464, 491, 48, new String[][]{
                    {"商圈与客源", summaryText(context.marketContext(), 32), "同商圈在营门店", context.localOperatingHotelCount() + " 家"},
                    {"市场租金参考", money(context.marketRentLow()) + " - " + money(context.marketRentHigh()) + " 元/㎡/月", "同规模新店参考投入", wan(context.sameScaleNewHotelInvestment()) + " 万元"},
                    {"品牌/运营验证", summaryText(context.operationEvidence(), 32), "改造后定位", summaryText(context.productPositioning(), 32)}
            });
            canvas.section("重要提示", "IMPORTANT NOTES", 52, 294);
            canvas.callout(52, 156, 491, 114, "使用与复核要求",
                    "本报告用于投资分析和沟通，不替代租赁、股权、税务、工程、法律或财务尽调。金额按万元列示并四舍五入，"
                            + "合计可能存在小额尾差。关键租赁条款、工程预算、收益分配及退出安排变化后，应重新测算并导出新版本报告",
                    "最终投资权益、分配与退出机制以经签署的正式协议为准。" );
            canvas.fillRect(52, 84, 491, 36, DEEP_GREEN);
            String footerProjectName = safe(input.projectName()) + " | 投资分析书";
            canvas.text(footerProjectName, canvas.fitToWidth(footerProjectName, 10, 300, FontRole.BOLD), 69, 97, WHITE, FontRole.BOLD);
            canvas.right("统一口径  ·  可复核  ·  可持续更新", 8, 525, 98, GOLD);
        });
    }

    private static ReportContext reportContext(ProfessionalPlanInput input) {
        ProfessionalReportNarrative narrative = input.reportNarrative();
        return new ReportContext(
                defaultText(narrative == null ? null : narrative.projectStatus(), "在营酒店，具备接手及开业条件，产品定位与经营效率存在提升空间。"),
                defaultText(narrative == null ? null : narrative.marketContext(), "成熟商务商圈，周边企业办公、协议客户及城市商务出行需求稳定。"),
                defaultDecimal(narrative == null ? null : narrative.sameScaleNewHotelInvestment(), BigDecimal.valueOf(7_500_000)),
                defaultDecimal(narrative == null ? null : narrative.marketRentLow(), BigDecimal.valueOf(25)),
                defaultDecimal(narrative == null ? null : narrative.marketRentHigh(), BigDecimal.valueOf(30)),
                defaultInteger(narrative == null ? null : narrative.localOperatingHotelCount(), 2),
                defaultText(narrative == null ? null : narrative.operationEvidence(), "入住率依据同商圈在营酒店的实际经营表现，并按稳健口径折算；ADR 按区域经营水平和产品升级后的价格能力测算。"),
                defaultText(narrative == null ? null : narrative.productPositioning(), "品质商务酒店，面向商务办公客户、企业协议客户、城市商务出行客户及中长期住宿客户。"),
                defaultText(narrative == null ? null : narrative.upgradeStrategy(), "首期投入完成品牌导入与客房、公共区域、智能化及配套体验升级；非收益优先项目可结合经营现金流分阶段投入。"),
                defaultInteger(narrative == null ? null : narrative.totalShares(), 100),
                defaultInteger(narrative == null ? null : narrative.minimumSubscriptionShares(), 10),
                defaultText(narrative == null ? null : narrative.distributionFrequency(), "每半年"),
                defaultInteger(narrative == null ? null : narrative.lockupYears(), 3),
                defaultInteger(narrative == null ? null : narrative.exitStartYear(), 4),
                defaultDecimal(narrative == null ? null : narrative.annualExitDepreciationRate(), new BigDecimal("0.20"))
        );
    }

    private static String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static String summaryText(String value, int length) {
        String cleaned = safe(value);
        if (cleaned.length() <= length) return cleaned;
        int boundary = -1;
        for (int index = 0; index < Math.min(cleaned.length(), length); index++) {
            char character = cleaned.charAt(index);
            if (character == '。' || character == '；' || character == '，') boundary = index;
        }
        return cleaned.substring(0, Math.max(1, boundary >= 6 ? boundary : length)).trim();
    }

    private static BigDecimal defaultDecimal(BigDecimal value, BigDecimal fallback) {
        return value == null ? fallback : value;
    }

    private static int defaultInteger(Integer value, int fallback) {
        return value == null ? fallback : value;
    }

    private static List<ProfessionalMaintenanceUpgrade> maintenanceItems(ProfessionalPlanInput input) {
        return input.maintenanceUpgrades() == null ? List.of() : input.maintenanceUpgrades();
    }

    private record ReportContext(
            String projectStatus,
            String marketContext,
            BigDecimal sameScaleNewHotelInvestment,
            BigDecimal marketRentLow,
            BigDecimal marketRentHigh,
            int localOperatingHotelCount,
            String operationEvidence,
            String productPositioning,
            String upgradeStrategy,
            int totalShares,
            int minimumSubscriptionShares,
            String distributionFrequency,
            int lockupYears,
            int exitStartYear,
            BigDecimal annualExitDepreciationRate
    ) {
    }

    @FunctionalInterface
    private interface PagePainter {
        void paint(Canvas canvas) throws IOException;
    }

    private record PdfColor(int red, int green, int blue) {
        private Color color() { return new Color(red, green, blue); }
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

    private record Metric(String label, String value, String note) {
    }

    private static final class Canvas {
        private final PDPageContentStream content;
        private final FontSet fonts;

        private Canvas(PDPageContentStream content, FontSet fonts) {
            this.content = content;
            this.fonts = fonts;
        }

        private void fillPage(PdfColor color) throws IOException { fillRect(0, 0, 595, 842, color); }

        private void frame(String section, String title, ProfessionalPlanInput input, int pageNo, int totalPages) throws IOException {
            fillPage(PAPER);
            fillRect(0, 802, 595, 40, DEEP_GREEN);
            String headerProjectName = safe(input.projectName()) + " | 投资分析书";
            text(headerProjectName, fitToWidth(headerProjectName, 10, 330, FontRole.BOLD), 42, 817, WHITE, FontRole.BOLD);
            right("INVESTMENT DECISION", 8, 553, 817, CREAM, FontRole.BOLD);
            fillRect(52, 770, 35, 3, GOLD);
            text(section + "  " + title, 22, 52, 738, DEEP_GREEN, FontRole.TITLE);
            text(input.roomCount() + " 间  |  " + input.leaseTermYears() + " 年租期", 8, 53, 715, MUTED);
            line(52, 40, 543, 40, GRID, 0.5);
            text("数据来源：项目填写数据；原始项目表格不在报告中展示", 7, 52, 24, MUTED);
            right("第 " + pageNo + " / " + totalPages + " 页", 7, 543, 24, MUTED);
        }

        private void section(String title, String english, double x, double y) throws IOException {
            text(title, 14, x, y, DEEP_GREEN, FontRole.TITLE);
            right(english, 7, 543, y + 1, GOLD, FontRole.BOLD);
            line(x, y - 9, 543, y - 9, GRID, 0.5);
        }

        private void metric(double x, double y, double width, double height, String label, String value, String unit, PdfColor accent) throws IOException {
            fillRect(x, y, width, height, MID_GREEN);
            fillRect(x, y + height - 4, width, 4, accent);
            text(label, fitToWidth(label, 9, width - 34, FontRole.BOLD), x + 17, y + height - 25, CREAM, FontRole.BOLD);
            text(value, fitToWidth(value, 21, width - 34, FontRole.BOLD), x + 17, y + 32, WHITE, FontRole.BOLD);
            right(unit, 8, x + width - 17, y + 16, accent, FontRole.BOLD);
        }

        private void metricStrip(double x, double y, double width, List<Metric> metrics) throws IOException {
            double gap = 8;
            double cardWidth = (width - gap * (metrics.size() - 1)) / metrics.size();
            for (int index = 0; index < metrics.size(); index++) {
                double left = x + index * (cardWidth + gap);
                fillRect(left, y, cardWidth, 66, index == 0 ? SOFT_GREEN : CREAM);
                fillRect(left, y + 62, cardWidth, 4, index == 0 ? MID_GREEN : GOLD);
                Metric metric = metrics.get(index);
                double textWidth = cardWidth - 20;
                text(metric.label(), fitToWidth(metric.label(), 7, textWidth, FontRole.BODY), left + 10, y + 43, MUTED);
                text(metric.value(), fitToWidth(metric.value(), 12, textWidth, FontRole.BOLD), left + 10, y + 20, DEEP_GREEN, FontRole.BOLD);
                text(clipToWidth(metric.note(), 6.5, textWidth, FontRole.BODY), 6.5, left + 10, y + 8, MUTED);
            }
        }

        private void keyValue(double x, double top, double width, double rowHeight, String[][] rows) throws IOException {
            double half = width / 2d;
            double labelWidth = 98;
            for (int index = 0; index < rows.length; index++) {
                double bottom = top - (index + 1) * rowHeight;
                if (index % 2 == 0) fillRect(x, bottom, width, rowHeight, CREAM);
                line(x, bottom, x + width, bottom, GRID, 0.45);
                text(clipToWidth(rows[index][0], 8, labelWidth - 12, FontRole.BODY), fitToWidth(rows[index][0], 8, labelWidth - 12, FontRole.BODY), x + 10, bottom + centeredBaseline(rowHeight, 8), MUTED);
                cellValue(rows[index][1], 9, x + labelWidth + 8, bottom, half - labelWidth - 16, rowHeight);
                text(clipToWidth(rows[index][2], 8, labelWidth - 12, FontRole.BODY), fitToWidth(rows[index][2], 8, labelWidth - 12, FontRole.BODY), x + half + 10, bottom + centeredBaseline(rowHeight, 8), MUTED);
                cellValue(rows[index][3], 9, x + half + labelWidth + 8, bottom, half - labelWidth - 16, rowHeight);
            }
            strokeRect(x, top - rows.length * rowHeight, width, rows.length * rowHeight, GRID, 0.5);
            line(x + half, top - rows.length * rowHeight, x + half, top, GRID, 0.45);
        }

        private void table(
                double x, double top, double[] widths, String[] headers, List<String[]> rows,
                boolean[] rightAligned, double rowHeight, double size
        ) throws IOException {
            double totalWidth = 0;
            for (double width : widths) totalWidth += width;
            fillRect(x, top - rowHeight, totalWidth, rowHeight, DEEP_GREEN);
            double cursor = x;
            for (int column = 0; column < headers.length; column++) {
                if (rightAligned[column]) right(headers[column], size, cursor + widths[column] - 6, top - rowHeight + 8, WHITE, FontRole.BOLD);
                else text(headers[column], size, cursor + 6, top - rowHeight + 8, WHITE, FontRole.BOLD);
                cursor += widths[column];
            }
            for (int row = 0; row < rows.size(); row++) {
                double bottom = top - (row + 2) * rowHeight;
                if (row % 2 == 0) fillRect(x, bottom, totalWidth, rowHeight, CREAM);
                cursor = x;
                for (int column = 0; column < headers.length; column++) {
                    String value = rows.get(row)[column];
                    double availableWidth = widths[column] - 12;
                    double fontSize = fitToWidth(value, size, availableWidth, FontRole.BODY);
                    String displayed = fontSize <= 5.8d ? clipToWidth(value, 5.8, availableWidth, FontRole.BODY) : value;
                    if (rightAligned[column]) right(displayed, fontSize, cursor + widths[column] - 6, bottom + 8, INK, FontRole.BODY);
                    else text(displayed, fontSize, cursor + 6, bottom + 8, INK);
                    cursor += widths[column];
                }
                line(x, bottom, x + totalWidth, bottom, GRID, 0.4);
            }
            strokeRect(x, top - (rows.size() + 1) * rowHeight, totalWidth, (rows.size() + 1) * rowHeight, GRID, 0.5);
        }

        private void callout(double x, double y, double width, double height, String title, String body, String note) throws IOException {
            fillRect(x, y, width, height, CREAM);
            fillRect(x, y, 4, height, GOLD);
            text(title, 11, x + 18, y + height - 24, DEEP_GREEN, FontRole.BOLD);
            int maxLines = note == null ? (height <= 80 ? 2 : 4) : (height <= 80 ? 2 : 3);
            wrap(body, 9.2, x + 18, y + height - 45, 49, 15, maxLines, INK);
            if (note != null && !note.isBlank()) text(clip(note, 66), 7.3, x + 18, y + 4, RISK);
        }

        private void wrap(String value, double size, double x, double y, int maxCharacters, double lineHeight, int maxLines, PdfColor color) throws IOException {
            List<String> lines = lines(value, maxCharacters);
            for (int index = 0; index < Math.min(maxLines, lines.size()); index++) {
                String line = lines.get(index);
                if (index == maxLines - 1 && lines.size() > maxLines) line = clip(line, Math.max(1, line.length() - 1)) + "…";
                text(line, size, x, y - index * lineHeight, color);
            }
        }

        private List<String> lines(String value, int maxCharacters) {
            List<String> result = new ArrayList<>();
            String cleaned = safe(value);
            if (cleaned.isBlank()) return result;
            StringBuilder current = new StringBuilder();
            for (int index = 0; index < cleaned.length(); index++) {
                char character = cleaned.charAt(index);
                if (character == '\n') {
                    if (!current.isEmpty()) result.add(current.toString());
                    current.setLength(0);
                } else {
                    current.append(character);
                    if (current.length() >= maxCharacters) {
                        result.add(current.toString());
                        current.setLength(0);
                    }
                }
            }
            if (!current.isEmpty()) result.add(current.toString());
            return result;
        }

        private void fillRect(double x, double y, double width, double height, PdfColor color) throws IOException {
            content.setNonStrokingColor(color.color());
            content.addRect((float) x, (float) y, (float) width, (float) height);
            content.fill();
        }

        private void strokeRect(double x, double y, double width, double height, PdfColor color, double lineWidth) throws IOException {
            content.setStrokingColor(color.color());
            content.setLineWidth((float) lineWidth);
            content.addRect((float) x, (float) y, (float) width, (float) height);
            content.stroke();
        }

        private void line(double x1, double y1, double x2, double y2, PdfColor color, double lineWidth) throws IOException {
            content.setStrokingColor(color.color());
            content.setLineWidth((float) lineWidth);
            content.moveTo((float) x1, (float) y1);
            content.lineTo((float) x2, (float) y2);
            content.stroke();
        }

        private void text(String value, double size, double x, double y, PdfColor color) throws IOException {
            text(value, size, x, y, color, FontRole.BODY);
        }

        private void text(String value, double size, double x, double y, PdfColor color, FontRole role) throws IOException {
            String cleaned = safe(value);
            if (cleaned.isBlank()) return;
            PDFont font = font(role);
            content.beginText();
            content.setFont(font, (float) size);
            content.setNonStrokingColor(color.color());
            content.newLineAtOffset((float) x, (float) y);
            content.showText(cleaned);
            content.endText();
        }

        private void right(String value, double size, double rightX, double y, PdfColor color, FontRole role) throws IOException {
            text(value, size, rightX - measuredWidth(value, size, role), y, color, role);
        }

        private void right(String value, double size, double rightX, double y, PdfColor color) throws IOException {
            right(value, size, rightX, y, color, FontRole.BODY);
        }

        private PDFont font(FontRole role) {
            return switch (role) {
                case TITLE -> fonts.serif();
                case BOLD -> fonts.bold();
                default -> fonts.sans();
            };
        }

        private double measuredWidth(String value, double size, FontRole role) throws IOException {
            return font(role).getStringWidth(safe(value)) / 1000d * size;
        }

        private double fitToWidth(String value, double defaultSize, double availableWidth, FontRole role) throws IOException {
            double textWidth = measuredWidth(value, defaultSize, role);
            if (textWidth <= availableWidth || textWidth == 0d) return defaultSize;
            return Math.max(5.8d, defaultSize * availableWidth / textWidth);
        }

        private void cellValue(String value, double defaultSize, double x, double bottom, double width, double rowHeight) throws IOException {
            double fontSize = defaultSize;
            List<String> wrapped = wrapToWidth(value, fontSize, width, FontRole.BODY);
            int maxLines = rowHeight >= 44 ? 2 : 1;
            while (wrapped.size() > maxLines && fontSize > 6.0d) {
                fontSize = Math.max(6.0d, fontSize - 0.5d);
                wrapped = wrapToWidth(value, fontSize, width, FontRole.BODY);
            }
            if (wrapped.size() > maxLines) {
                wrapped = List.of(clipToWidth(value, fontSize, width, FontRole.BODY));
            }
            double lineHeight = fontSize + 2;
            double firstBaseline = bottom + (rowHeight + (wrapped.size() - 1) * lineHeight - fontSize) / 2d;
            for (int index = 0; index < wrapped.size(); index++) {
                text(wrapped.get(index), fontSize, x, firstBaseline - index * lineHeight, INK);
            }
        }

        private List<String> wrapToWidth(String value, double size, double width, FontRole role) throws IOException {
            List<String> result = new ArrayList<>();
            String cleaned = safe(value);
            if (cleaned.isBlank()) return List.of();
            StringBuilder current = new StringBuilder();
            for (int index = 0; index < cleaned.length(); index++) {
                char character = cleaned.charAt(index);
                if (character == '\n') {
                    if (!current.isEmpty()) result.add(current.toString());
                    current.setLength(0);
                    continue;
                }
                current.append(character);
                if (measuredWidth(current.toString(), size, role) > width && current.length() > 1) {
                    current.setLength(current.length() - 1);
                    result.add(current.toString());
                    current.setLength(0);
                    current.append(character);
                }
            }
            if (!current.isEmpty()) result.add(current.toString());
            return result;
        }

        private String clipToWidth(String value, double size, double width, FontRole role) throws IOException {
            String cleaned = safe(value);
            if (measuredWidth(cleaned, size, role) <= width) return cleaned;
            String suffix = "...";
            StringBuilder result = new StringBuilder();
            for (int index = 0; index < cleaned.length(); index++) {
                result.append(cleaned.charAt(index));
                if (measuredWidth(result + suffix, size, role) > width) {
                    result.setLength(Math.max(0, result.length() - 1));
                    break;
                }
            }
            return result + suffix;
        }

        private double centeredBaseline(double rowHeight, double fontSize) {
            return (rowHeight - fontSize) / 2d;
        }

        private String clip(String value, int length) {
            if (value == null || value.length() <= length) return value == null ? "" : value;
            return value.substring(0, Math.max(1, length - 1)) + "…";
        }
    }
}
