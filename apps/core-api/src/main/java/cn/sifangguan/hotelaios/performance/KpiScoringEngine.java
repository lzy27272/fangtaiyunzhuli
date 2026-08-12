package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Component
public class KpiScoringEngine {
    private static final BigDecimal ONE_HUNDRED = BigDecimal.valueOf(100);

    public KpiModels.ScoreResult score(
            List<KpiModels.TemplateRule> rules,
            Map<UUID, KpiModels.MetricAggregate> aggregates,
            Map<UUID, BigDecimal> manualScores,
            boolean weekly,
            Integer weekNo
    ) {
        List<KpiModels.IndicatorScore> indicatorScores = new ArrayList<>();
        BigDecimal base = BigDecimal.ZERO;
        BigDecimal extra = BigDecimal.ZERO;
        boolean pendingManual = false;
        boolean pendingVerification = false;

        for (KpiModels.TemplateRule rule : rules) {
            BigDecimal target = weeklyTarget(rule, weekly, weekNo);
            if (weekly && "MONTH_END_ONLY".equals(rule.weeklySplitType())) {
                indicatorScores.add(result(rule, "NOT_APPLICABLE", "PENDING", target, null,
                        null, null, null, detail("仅月末确认，本周只展示进度")));
                continue;
            }

            if ("MANUAL".equals(rule.indicatorType())) {
                BigDecimal manual = manualScores.get(rule.id());
                if (manual == null) {
                    pendingManual = true;
                    indicatorScores.add(result(rule, "PENDING_VERIFICATION", "PENDING", target,
                            null, null, null, null, detail("等待评价人直接录入分数和证据")));
                    continue;
                }
                BigDecimal validated = bounded(manual, rule.minScore(), rule.maxScore(), rule.allowAboveMax());
                BigDecimal basePart = validated.min(rule.maxScore());
                BigDecimal extraPart = validated.subtract(basePart).max(BigDecimal.ZERO);
                base = base.add(basePart);
                extra = extra.add(extraPart);
                indicatorScores.add(result(rule, "AVAILABLE", outcome(validated, rule.maxScore()), target,
                        manual, null, null, validated, detail("人工评分")));
                continue;
            }

            KpiModels.MetricAggregate aggregate = rule.metricVersionId() == null
                    ? null : aggregates.get(rule.metricVersionId());
            if (aggregate == null || "PENDING_VERIFICATION".equals(aggregate.state())
                    || "UNAVAILABLE".equals(aggregate.state())) {
                pendingVerification = true;
                indicatorScores.add(result(rule, aggregate == null ? "PENDING_VERIFICATION" : aggregate.state(),
                        "PENDING", target, aggregate == null ? null : aggregate.value(),
                        aggregate == null ? null : aggregate.numerator(),
                        aggregate == null ? null : aggregate.denominator(), null,
                        detail("必要数据缺失或来源待核验，禁止按0分处理")));
                continue;
            }

            if ("NOT_APPLICABLE".equals(aggregate.state())) {
                BigDecimal score = notApplicableScore(rule);
                if (score == null) {
                    pendingVerification = true;
                    indicatorScores.add(result(rule, "NOT_APPLICABLE", "PENDING", target,
                            aggregate.value(), aggregate.numerator(), aggregate.denominator(), null,
                            detail("指标不适用，等待模板规则或审批确认")));
                } else {
                    base = base.add(score);
                    indicatorScores.add(result(rule, "NOT_APPLICABLE", "NOT_APPLICABLE", target,
                            aggregate.value(), aggregate.numerator(), aggregate.denominator(), score,
                            detail("按模板预设的不适用规则处理")));
                }
                continue;
            }

            BigDecimal actual = aggregate.value();
            BigDecimal rawScore = calculate(rule, actual, target);
            BigDecimal bounded = bounded(rawScore, rule.minScore(), rule.maxScore(), rule.allowAboveMax());
            BigDecimal basePart = bounded.min(rule.maxScore());
            BigDecimal extraPart = bounded.subtract(basePart).max(BigDecimal.ZERO);
            base = base.add(basePart);
            extra = extra.add(extraPart);
            ObjectNode details = detail("系统按冻结规则自动计算");
            details.put("observationCount", aggregate.observationCount());
            details.set("sourceSnapshot", aggregate.sourceSnapshot() == null
                    ? JsonNodeFactory.instance.objectNode() : aggregate.sourceSnapshot());
            indicatorScores.add(result(rule, aggregate.state(), outcome(bounded, rule.maxScore()), target,
                    actual, aggregate.numerator(), aggregate.denominator(), bounded, details));
        }

        return new KpiModels.ScoreResult(
                List.copyOf(indicatorScores),
                base.setScale(4, RoundingMode.HALF_UP),
                extra.setScale(4, RoundingMode.HALF_UP),
                base.add(extra).setScale(4, RoundingMode.HALF_UP),
                pendingManual,
                pendingVerification
        );
    }

    private BigDecimal calculate(KpiModels.TemplateRule rule, BigDecimal actual, BigDecimal target) {
        if ("BONUS_ADJUSTMENT".equals(rule.indicatorType())) {
            return BigDecimal.ZERO;
        }
        if (actual == null) {
            return BigDecimal.ZERO;
        }
        String type = rule.indicatorType().toUpperCase(Locale.ROOT);
        return switch (type) {
            case "EVENT_DEDUCTION" -> {
                BigDecimal perEvent = decimal(rule.formulaConfig(), "deductionPerEvent", BigDecimal.ONE);
                yield rule.maxScore().subtract(actual.multiply(perEvent));
            }
            case "CONDITION" -> truthy(actual) ? rule.maxScore() : BigDecimal.ZERO;
            case "COMPLETION_RATE", "ON_TIME", "MILESTONE" ->
                    proportional(rule, actual, target == null ? BigDecimal.ONE : target);
            case "COMPOSITE" -> "ACTUAL".equalsIgnoreCase(text(rule.formulaConfig(), "scoreMode", "PROPORTIONAL"))
                    ? actual
                    : proportional(rule, actual, target == null ? BigDecimal.ONE : target);
            case "TARGET" -> targetScore(rule, actual, target);
            default -> throw new IllegalArgumentException("不支持的KPI指标类型：" + type);
        };
    }

    private BigDecimal targetScore(KpiModels.TemplateRule rule, BigDecimal actual, BigDecimal target) {
        String mode = text(rule.formulaConfig(), "scoreMode", "BINARY").toUpperCase(Locale.ROOT);
        if ("BANDS".equals(mode)) {
            JsonNode bands = rule.formulaConfig() == null ? null : rule.formulaConfig().path("bands");
            if (bands != null && bands.isArray()) {
                for (JsonNode band : bands) {
                    BigDecimal min = band.hasNonNull("min") ? band.path("min").decimalValue() : null;
                    BigDecimal max = band.hasNonNull("max") ? band.path("max").decimalValue() : null;
                    if ((min == null || actual.compareTo(min) >= 0) && (max == null || actual.compareTo(max) < 0)) {
                        return band.hasNonNull("score") ? band.path("score").decimalValue() : BigDecimal.ZERO;
                    }
                }
            }
            return BigDecimal.ZERO;
        }
        if ("PROPORTIONAL".equals(mode)) {
            return proportional(rule, actual, target);
        }
        String comparison = text(rule.formulaConfig(), "comparison", "GTE").toUpperCase(Locale.ROOT);
        if (target == null) {
            return truthy(actual) ? rule.maxScore() : BigDecimal.ZERO;
        }
        boolean pass = switch (comparison) {
            case "GT" -> actual.compareTo(target) > 0;
            case "LTE" -> actual.compareTo(target) <= 0;
            case "LT" -> actual.compareTo(target) < 0;
            case "EQ" -> actual.compareTo(target) == 0;
            default -> actual.compareTo(target) >= 0;
        };
        return pass ? rule.maxScore() : BigDecimal.ZERO;
    }

    private BigDecimal proportional(KpiModels.TemplateRule rule, BigDecimal actual, BigDecimal target) {
        if (target == null || target.compareTo(BigDecimal.ZERO) == 0) {
            return truthy(actual) ? rule.maxScore() : BigDecimal.ZERO;
        }
        String comparison = text(rule.formulaConfig(), "comparison", "GTE").toUpperCase(Locale.ROOT);
        BigDecimal achievement;
        if ("LTE".equals(comparison) || "LT".equals(comparison)) {
            achievement = actual.compareTo(BigDecimal.ZERO) == 0
                    ? BigDecimal.ONE : target.divide(actual, 8, RoundingMode.HALF_UP);
        } else {
            achievement = actual.divide(target, 8, RoundingMode.HALF_UP);
        }
        return rule.maxScore().multiply(achievement);
    }

    private BigDecimal weeklyTarget(KpiModels.TemplateRule rule, boolean weekly, Integer weekNo) {
        BigDecimal target = rule.targetValue();
        if (!weekly || target == null) {
            return target;
        }
        return switch (rule.weeklySplitType()) {
            case "EQUAL_FOUR_WEEKS" -> target.divide(BigDecimal.valueOf(4), 8, RoundingMode.HALF_UP);
            case "CUSTOM_FOUR_WEEKS" -> {
                JsonNode weights = rule.formulaConfig() == null ? null : rule.formulaConfig().path("weeklyWeights");
                int index = weekNo == null ? -1 : weekNo - 1;
                if (weights == null || !weights.isArray() || index < 0 || index >= weights.size()
                        || !weights.get(index).isNumber()) {
                    throw new IllegalArgumentException("自定义四周比例缺少week " + weekNo + " 的权重");
                }
                yield target.multiply(weights.get(index).decimalValue());
            }
            default -> target;
        };
    }

    private BigDecimal notApplicableScore(KpiModels.TemplateRule rule) {
        return switch (rule.notApplicablePolicy()) {
            case "FULL_SCORE" -> rule.maxScore();
            case "PROPORTIONAL_SECTION" -> null;
            case "ALTERNATE_INDICATOR" -> null;
            default -> null;
        };
    }

    private BigDecimal bounded(BigDecimal value, BigDecimal minimum, BigDecimal maximum, boolean allowAboveMaximum) {
        BigDecimal result = value;
        if (minimum != null && result.compareTo(minimum) < 0) {
            result = minimum;
        }
        if (!allowAboveMaximum && maximum != null && result.compareTo(maximum) > 0) {
            result = maximum;
        }
        return result;
    }

    private KpiModels.IndicatorScore result(
            KpiModels.TemplateRule rule,
            String dataState,
            String outcome,
            BigDecimal target,
            BigDecimal actual,
            BigDecimal numerator,
            BigDecimal denominator,
            BigDecimal score,
            JsonNode details
    ) {
        return new KpiModels.IndicatorScore(rule.id(), rule.sectionCode(), rule.indicatorCode(), rule.name(),
                dataState, outcome, target, actual, numerator, denominator, score,
                rule.maxScore(), rule.minScore(), details);
    }

    private String outcome(BigDecimal score, BigDecimal maxScore) {
        if (score == null) return "PENDING";
        if (score.compareTo(maxScore) >= 0) return "PASS";
        if (score.compareTo(BigDecimal.ZERO) > 0) return "WARNING";
        return "FAIL";
    }

    private boolean truthy(BigDecimal value) {
        return value != null && value.compareTo(BigDecimal.ZERO) > 0;
    }

    private String text(JsonNode node, String field, String fallback) {
        return node != null && node.hasNonNull(field) ? node.path(field).asText(fallback) : fallback;
    }

    private BigDecimal decimal(JsonNode node, String field, BigDecimal fallback) {
        return node != null && node.hasNonNull(field) && node.path(field).isNumber()
                ? node.path(field).decimalValue() : fallback;
    }

    private ObjectNode detail(String message) {
        return JsonNodeFactory.instance.objectNode().put("message", message);
    }
}
