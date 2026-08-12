package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class KpiImportedTierEvaluator {
    private static final Pattern PERCENT_RANGE = Pattern.compile("^([0-9]+(?:\\.[0-9]+)?)%?\\s*[-~至]\\s*([0-9]+(?:\\.[0-9]+)?)%$");
    private static final Pattern PERCENT_EXACT = Pattern.compile("^([0-9]+(?:\\.[0-9]+)?)%$");
    private static final Pattern NUMBER_EXACT = Pattern.compile("^([0-9]+(?:\\.[0-9]+)?)(?:条|个|次|项|家)?$");

    Evaluation evaluate(JsonNode formulaConfig, BigDecimal actual, String unit) {
        JsonNode tiers = formulaConfig == null ? null : formulaConfig.path("scoreTiers");
        if (tiers == null || !tiers.isArray() || tiers.isEmpty()) {
            return Evaluation.pending("未配置可自动判定的评分档次");
        }
        List<TierBoundary> boundaries = new ArrayList<>();
        for (JsonNode tier : tiers) {
            String target = tier.path("target").asText("").trim();
            if (target.isBlank() || !tier.has("score") || !tier.path("score").isNumber()) continue;
            TierBoundary boundary = parse(target, unit);
            if (boundary == null) continue;
            boundaries.add(boundary);
            if (boundary.matches(actual)) {
                return Evaluation.scored(tier.path("score").decimalValue(), target);
            }
        }
        if (boundaries.isEmpty()) return Evaluation.pending("评分档次尚未转换为量化规则");
        if (hasPercentGap(boundaries, actual, unit)) {
            return Evaluation.pending("当前数值落在评分档次空档，需先补齐规则后才能自动计分");
        }
        return Evaluation.scored(BigDecimal.ZERO, "未进入任何得分档");
    }

    private TierBoundary parse(String raw, String unit) {
        String target = raw.replace("％", "%").replace("–", "-").replace("—", "-")
                .replace(" ", "").toUpperCase(Locale.ROOT);
        Matcher percentRange = PERCENT_RANGE.matcher(target);
        if (percentRange.matches()) {
            BigDecimal lower = new BigDecimal(percentRange.group(1));
            BigDecimal upper = new BigDecimal(percentRange.group(2));
            BigDecimal exclusiveUpper = upper.scale() == 0 ? upper.add(BigDecimal.ONE) : upper;
            return TierBoundary.percentRange(lower, exclusiveUpper);
        }
        Matcher percentExact = PERCENT_EXACT.matcher(target);
        if (percentExact.matches()) {
            BigDecimal value = new BigDecimal(percentExact.group(1));
            return TierBoundary.percentExact(value);
        }
        if (target.startsWith("≤") || target.startsWith("<=")) {
            BigDecimal value = decimal(target.replaceFirst("^(≤|<=)", ""));
            return value == null ? null : TierBoundary.upper(value, true, isRatio(unit));
        }
        if (target.startsWith("<")) {
            BigDecimal value = decimal(target.substring(1));
            return value == null ? null : TierBoundary.upper(value, false, isRatio(unit));
        }
        if (target.startsWith("≥") || target.startsWith(">=")) {
            BigDecimal value = decimal(target.replaceFirst("^(≥|>=)", ""));
            return value == null ? null : TierBoundary.lower(value, true, isRatio(unit));
        }
        if (target.startsWith(">")) {
            BigDecimal value = decimal(target.substring(1));
            return value == null ? null : TierBoundary.lower(value, false, isRatio(unit));
        }
        Matcher exact = NUMBER_EXACT.matcher(target);
        if (exact.matches()) {
            BigDecimal value = new BigDecimal(exact.group(1));
            return isRatio(unit) ? TierBoundary.ratioTarget(value) : TierBoundary.numberExact(value);
        }
        return null;
    }

    private boolean hasPercentGap(List<TierBoundary> boundaries, BigDecimal actual, String unit) {
        if (!isRatio(unit)) return false;
        BigDecimal percent = actual.multiply(BigDecimal.valueOf(100));
        boolean hasHundredTarget = boundaries.stream().anyMatch(item -> item.kind == Kind.PERCENT_EXACT
                && item.lower.compareTo(BigDecimal.valueOf(100)) == 0)
                || boundaries.stream().anyMatch(item -> item.kind == Kind.RATIO_TARGET
                && item.lower.compareTo(BigDecimal.ONE) == 0);
        BigDecimal highestRange = boundaries.stream()
                .filter(item -> item.kind == Kind.PERCENT_RANGE)
                .map(item -> item.upper)
                .max(BigDecimal::compareTo).orElse(BigDecimal.ZERO);
        return hasHundredTarget && percent.compareTo(highestRange) >= 0 && percent.compareTo(BigDecimal.valueOf(100)) < 0;
    }

    private BigDecimal decimal(String raw) {
        String cleaned = raw.replaceAll("(?:条|个|次|项|家|%)$", "");
        try {
            return new BigDecimal(cleaned);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private boolean isRatio(String unit) {
        return unit != null && (unit.equalsIgnoreCase("RATIO") || unit.equals("比例") || unit.equals("%"));
    }

    record Evaluation(boolean calculable, BigDecimal score, String matchedTier, String reason) {
        static Evaluation scored(BigDecimal score, String tier) {
            return new Evaluation(true, score, tier, null);
        }

        static Evaluation pending(String reason) {
            return new Evaluation(false, null, null, reason);
        }
    }

    private enum Kind { PERCENT_RANGE, PERCENT_EXACT, RATIO_TARGET, NUMBER_EXACT, LOWER, UPPER }

    private record TierBoundary(Kind kind, BigDecimal lower, BigDecimal upper, boolean lowerInclusive,
                                boolean upperInclusive, boolean ratio) {
        static TierBoundary percentRange(BigDecimal lower, BigDecimal upper) {
            return new TierBoundary(Kind.PERCENT_RANGE, lower, upper, true, false, true);
        }

        static TierBoundary percentExact(BigDecimal value) {
            return new TierBoundary(Kind.PERCENT_EXACT, value, value, true, true, true);
        }

        static TierBoundary ratioTarget(BigDecimal value) {
            return new TierBoundary(Kind.RATIO_TARGET, value, value, true, true, true);
        }

        static TierBoundary numberExact(BigDecimal value) {
            return new TierBoundary(Kind.NUMBER_EXACT, value, value, true, true, false);
        }

        static TierBoundary lower(BigDecimal value, boolean inclusive, boolean ratio) {
            return new TierBoundary(Kind.LOWER, value, null, inclusive, false, ratio);
        }

        static TierBoundary upper(BigDecimal value, boolean inclusive, boolean ratio) {
            return new TierBoundary(Kind.UPPER, null, value, false, inclusive, ratio);
        }

        boolean matches(BigDecimal actual) {
            BigDecimal comparable = ratio && kind != Kind.RATIO_TARGET ? actual.multiply(BigDecimal.valueOf(100)) : actual;
            if (kind == Kind.RATIO_TARGET) return comparable.compareTo(lower) >= 0;
            if (kind == Kind.PERCENT_EXACT || kind == Kind.NUMBER_EXACT) return comparable.compareTo(lower) == 0;
            if (lower != null) {
                int comparison = comparable.compareTo(lower);
                if (comparison < 0 || comparison == 0 && !lowerInclusive) return false;
            }
            if (upper != null) {
                int comparison = comparable.compareTo(upper);
                if (comparison > 0 || comparison == 0 && !upperInclusive) return false;
            }
            return true;
        }
    }
}
