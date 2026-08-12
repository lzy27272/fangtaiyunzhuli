package cn.sifangguan.hotelaios.performance;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Component
final class KpiWorkbookAnalyzer {
    private static final Pattern NUMBER = Pattern.compile("[-+]?\\d+(?:\\.\\d+)?");
    private static final Map<String, String> POSITION_CODES = Map.of(
            "店长", "GENERAL_MANAGER",
            "店助", "ASSISTANT_GENERAL_MANAGER",
            "服务管家", "FRONT_OFFICE_SUPERVISOR",
            "前台", "FRONT_DESK",
            "客房", "HOUSEKEEPING_ATTENDANT"
    );

    Analysis analyze(SimpleXlsxReader.WorkbookData workbook, List<PositionOption> positions) {
        Map<String, PositionOption> positionsByCode = new LinkedHashMap<>();
        for (PositionOption position : positions) positionsByCode.put(position.code(), position);
        List<DetectedTemplate> templates = new ArrayList<>();
        List<IgnoredSheet> ignored = new ArrayList<>();
        for (SimpleXlsxReader.SheetData sheet : workbook.sheets()) {
            String positionCode = POSITION_CODES.get(sheet.name());
            int headerIndex = findHeader(sheet.rows());
            if (positionCode == null || headerIndex < 0) {
                ignored.add(new IgnoredSheet(sheet.name(), positionCode == null
                        ? "该表属于规则、考勤、工资或提成数据，不生成岗位模板"
                        : "未找到“指标类别/考核项目”表头"));
                continue;
            }
            templates.add(analyzeTemplate(sheet, headerIndex, positionCode, positionsByCode.get(positionCode)));
        }
        return new Analysis(List.copyOf(templates), List.copyOf(ignored));
    }

    private DetectedTemplate analyzeTemplate(
            SimpleXlsxReader.SheetData sheet,
            int headerIndex,
            String positionCode,
            PositionOption suggestedPosition
    ) {
        int endIndex = sheet.rows().size();
        for (int index = headerIndex + 1; index < sheet.rows().size(); index++) {
            if (isHeader(sheet.rows().get(index))) {
                endIndex = index;
                break;
            }
        }
        Map<String, IndicatorBuilder> grouped = new LinkedHashMap<>();
        BigDecimal declaredFullScore = null;
        List<String> notes = new ArrayList<>();
        for (int index = headerIndex + 1; index < endIndex; index++) {
            List<String> row = sheet.rows().get(index);
            String category = cell(row, 0);
            String indicator = cell(row, 1);
            String criteria = cell(row, 2);
            if ("总分".equals(category) || "总分".equals(indicator)) {
                declaredFullScore = score(cell(row, 5));
                break;
            }
            if (category.startsWith("绩效考核标准")) {
                notes.add(category);
                continue;
            }
            if (category.isBlank() || indicator.isBlank()) {
                if (!criteria.isBlank()) notes.add(criteria);
                continue;
            }
            if (category.contains("扣分项") || indicator.equals("扣分项")) continue;
            boolean redline = category.equals("红线");
            boolean bonus = isBonus(category, indicator);
            String key = category + "\u0000" + indicator + ((redline || bonus) ? "\u0000" + criteria : "");
            IndicatorBuilder builder = grouped.computeIfAbsent(key,
                    ignored -> new IndicatorBuilder(category, indicator, redline, bonus));
            builder.criteria.add(criteria);
            builder.weightTexts.add(cell(row, 4));
            BigDecimal tierScore = score(cell(row, 5));
            builder.tiers.add(new ScoreTier(cell(row, 3), tierScore));
            if (tierScore != null) {
                if (builder.maximum == null || tierScore.compareTo(builder.maximum) > 0) builder.maximum = tierScore;
                if (builder.minimum == null || tierScore.compareTo(builder.minimum) < 0) builder.minimum = tierScore;
            }
        }
        List<DetectedIndicator> indicators = new ArrayList<>();
        BigDecimal calculatedFullScore = BigDecimal.ZERO;
        int sortOrder = 0;
        for (IndicatorBuilder builder : grouped.values()) {
            BigDecimal maximum = builder.redline || builder.bonus ? BigDecimal.ZERO
                    : (builder.maximum == null ? BigDecimal.ZERO : builder.maximum.max(BigDecimal.ZERO));
            BigDecimal minimum = builder.redline || builder.bonus ? null
                    : (builder.minimum != null && builder.minimum.signum() < 0 ? builder.minimum : BigDecimal.ZERO);
            calculatedFullScore = calculatedFullScore.add(maximum);
            String criteria = String.join("\n", builder.criteria.stream().filter(value -> !value.isBlank()).toList());
            indicators.add(new DetectedIndicator(
                    builder.category,
                    builder.indicator,
                    criteria,
                    maximum,
                    minimum,
                    builder.redline,
                    builder.bonus,
                    hasExtraPolicy(criteria),
                    weeklySplit(builder.indicator, criteria, builder.redline || builder.bonus),
                    numericTarget(builder.tiers),
                    builder.weightTexts.stream().filter(value -> !value.isBlank()).findFirst().orElse(""),
                    List.copyOf(builder.tiers),
                    sortOrder++
            ));
        }
        BigDecimal baseFullScore = declaredFullScore == null ? calculatedFullScore : declaredFullScore;
        List<String> warnings = new ArrayList<>();
        if (calculatedFullScore.compareTo(baseFullScore) != 0) {
            warnings.add("基础指标满分合计" + calculatedFullScore.stripTrailingZeros().toPlainString()
                    + "，与表内总分" + baseFullScore.stripTrailingZeros().toPlainString() + "不一致，请在草稿中确认");
        }
        if ("服务管家".equals(sheet.name())) {
            warnings.add("“服务管家”暂建议匹配“前厅主管”，生成草稿前可改选其他岗位");
        }
        warnings.add("Excel未声明系统数据源，先按可录分草稿导入；绑定数据指标后再启用自动评分");
        BigDecimal bonusBase = bonusBase(sheet.rows().get(Math.max(0, headerIndex - 1)));
        String templateCode = "STORE_" + positionCode + "_KPI";
        String templateName = sheet.name() + "KPI考核模板";
        return new DetectedTemplate(
                sheet.name(), templateCode, templateName, baseFullScore, bonusBase,
                suggestedPosition == null ? null : suggestedPosition.id(), positionCode,
                suggestedPosition == null ? positionCode : suggestedPosition.name(),
                "服务管家".equals(sheet.name()) ? "SUGGESTED" : "HIGH",
                List.copyOf(indicators), List.copyOf(warnings), List.copyOf(notes)
        );
    }

    private int findHeader(List<List<String>> rows) {
        for (int index = 0; index < rows.size(); index++) if (isHeader(rows.get(index))) return index;
        return -1;
    }

    private boolean isHeader(List<String> row) {
        return "指标类别".equals(cell(row, 0)) && "考核项目".equals(cell(row, 1));
    }

    private boolean isBonus(String category, String indicator) {
        return category.contains("加分") || category.contains("创新") || indicator.contains("加分项")
                || Set.of("好评激励", "学习时长", "差评控制率", "差评管控").contains(indicator);
    }

    private boolean hasExtraPolicy(String criteria) {
        return criteria.contains("额外") || criteria.contains("加分") || criteria.contains("＋") || criteria.contains("+");
    }

    private String weeklySplit(String indicator, String criteria, boolean special) {
        if (special) return "SAME_TARGET";
        if (indicator.equalsIgnoreCase("GMV") || criteria.contains("100/月") || criteria.contains("每月四次")) {
            return "EQUAL_FOUR_WEEKS";
        }
        return "SAME_TARGET";
    }

    private BigDecimal numericTarget(List<ScoreTier> tiers) {
        if (tiers.isEmpty()) return null;
        String value = tiers.getFirst().target().trim();
        if (value.matches("[-+]?\\d+(?:\\.\\d+)?")) {
            try {
                return new BigDecimal(value);
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private BigDecimal bonusBase(List<String> row) {
        for (int index = 0; index < row.size(); index++) {
            if (!cell(row, index).contains("绩效基数")) continue;
            for (int next = index + 1; next < row.size(); next++) {
                BigDecimal value = score(cell(row, next));
                if (value != null) return value;
            }
        }
        return null;
    }

    private BigDecimal score(String value) {
        if (value == null || value.isBlank() || value.contains("加分项")) return null;
        Matcher matcher = NUMBER.matcher(value.replace(",", ""));
        if (!matcher.find()) return null;
        try {
            return new BigDecimal(matcher.group());
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private String cell(List<String> row, int index) {
        return index >= 0 && index < row.size() && row.get(index) != null ? row.get(index).trim() : "";
    }

    record PositionOption(UUID id, String code, String name) {
    }

    record Analysis(List<DetectedTemplate> templates, List<IgnoredSheet> ignoredSheets) {
    }

    record IgnoredSheet(String sheetName, String reason) {
    }

    record DetectedTemplate(
            String sheetName,
            String templateCode,
            String templateName,
            BigDecimal baseFullScore,
            BigDecimal bonusBase,
            UUID suggestedPositionId,
            String suggestedPositionCode,
            String suggestedPositionName,
            String matchConfidence,
            List<DetectedIndicator> indicators,
            List<String> warnings,
            List<String> notes
    ) {
    }

    record DetectedIndicator(
            String section,
            String name,
            String criteria,
            BigDecimal maxScore,
            BigDecimal minScore,
            boolean redline,
            boolean bonus,
            boolean allowAboveMax,
            String weeklySplitType,
            BigDecimal targetValue,
            String sourceWeight,
            List<ScoreTier> tiers,
            int sortOrder
    ) {
    }

    record ScoreTier(String target, BigDecimal score) {
    }

    private static final class IndicatorBuilder {
        private final String category;
        private final String indicator;
        private final boolean redline;
        private final boolean bonus;
        private final Set<String> criteria = new LinkedHashSet<>();
        private final Set<String> weightTexts = new LinkedHashSet<>();
        private final List<ScoreTier> tiers = new ArrayList<>();
        private BigDecimal maximum;
        private BigDecimal minimum;

        private IndicatorBuilder(String category, String indicator, boolean redline, boolean bonus) {
            this.category = category;
            this.indicator = indicator;
            this.redline = redline;
            this.bonus = bonus;
        }
    }
}
