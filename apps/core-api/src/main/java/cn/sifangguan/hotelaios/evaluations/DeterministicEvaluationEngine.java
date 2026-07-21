package cn.sifangguan.hotelaios.evaluations;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Component
public class DeterministicEvaluationEngine {
    public Result evaluate(JsonNode standardItems, JsonNode scoringRules, JsonNode input) {
        if (!standardItems.isArray() || standardItems.isEmpty()) {
            throw new IllegalArgumentException("标准版本必须至少包含一个结构化评价条目");
        }
        BigDecimal fullScore = decimal(scoringRules.path("fullScore"), BigDecimal.valueOf(100));
        BigDecimal passScore = decimal(scoringRules.path("passScore"), fullScore.multiply(BigDecimal.valueOf(0.8)));
        BigDecimal defaultWeight = fullScore.divide(BigDecimal.valueOf(standardItems.size()), 4, RoundingMode.HALF_UP);
        List<ItemResult> results = new ArrayList<>();
        BigDecimal total = BigDecimal.ZERO;
        boolean pending = false;
        boolean requiredFailure = false;
        for (JsonNode item : standardItems) {
            String code = item.path("code").asText();
            if (code.isBlank()) {
                throw new IllegalArgumentException("标准评价条目缺少code");
            }
            String mode = item.path("mode").asText(item.path("manual").asBoolean(false) ? "MANUAL" : "DETERMINISTIC")
                    .toUpperCase(Locale.ROOT);
            BigDecimal itemFull = decimal(item.path("weight"), defaultWeight);
            JsonNode actual = actual(input, code);
            if ("MANUAL".equals(mode) || "AI_RESERVED".equals(mode)) {
                pending = true;
                results.add(new ItemResult(code, mode, "PENDING", BigDecimal.ZERO, itemFull,
                        item.path("operator").asText("PRESENT"), item.get("expected"), actual,
                        "等待人工判断"));
                continue;
            }
            String operator = item.path("operator").asText(item.path("required").asBoolean(false) ? "PRESENT" : "TRUTHY")
                    .toUpperCase(Locale.ROOT);
            JsonNode expected = item.has("expected") ? item.get("expected") : JsonNodeFactory.instance.booleanNode(true);
            boolean pass = matches(operator, actual, expected);
            BigDecimal score = pass ? itemFull : BigDecimal.ZERO;
            total = total.add(score);
            requiredFailure |= item.path("required").asBoolean(false) && !pass;
            results.add(new ItemResult(code, mode, pass ? "PASS" : "FAIL", score, itemFull,
                    operator, expected, actual, pass ? "符合标准" : "未满足标准条件"));
        }
        String outcome;
        String executionStatus;
        if (pending) {
            outcome = "PENDING";
            executionStatus = "PENDING_MANUAL";
        } else if (!requiredFailure && total.compareTo(passScore) >= 0) {
            outcome = "PASS";
            executionStatus = "COMPLETED";
        } else {
            outcome = "FAIL";
            executionStatus = "COMPLETED";
        }
        return new Result(results, total.setScale(2, RoundingMode.HALF_UP),
                fullScore.setScale(2, RoundingMode.HALF_UP), outcome, executionStatus);
    }

    private boolean matches(String operator, JsonNode actual, JsonNode expected) {
        return switch (operator) {
            case "PRESENT" -> actual != null && !actual.isNull()
                    && (!actual.isTextual() || !actual.asText().isBlank());
            case "TRUTHY" -> actual != null && !actual.isNull()
                    && (actual.isBoolean() ? actual.asBoolean() : !actual.asText().isBlank());
            case "EQ" -> actual != null && actual.equals(expected);
            case "NE" -> actual == null || !actual.equals(expected);
            case "GT", "GTE", "LT", "LTE" -> compare(operator, actual, expected);
            default -> throw new IllegalArgumentException("不支持的标准评价操作符: " + operator);
        };
    }

    private boolean compare(String operator, JsonNode actual, JsonNode expected) {
        if (actual == null || !actual.isNumber() || expected == null || !expected.isNumber()) {
            return false;
        }
        int compared = actual.decimalValue().compareTo(expected.decimalValue());
        return switch (operator) {
            case "GT" -> compared > 0;
            case "GTE" -> compared >= 0;
            case "LT" -> compared < 0;
            case "LTE" -> compared <= 0;
            default -> false;
        };
    }

    private JsonNode actual(JsonNode input, String code) {
        if (input == null || input.isNull()) {
            return null;
        }
        if (input.has(code)) {
            return input.get(code);
        }
        JsonNode checks = input.path("checks");
        return checks.isObject() && checks.has(code) ? checks.get(code) : null;
    }

    private BigDecimal decimal(JsonNode value, BigDecimal fallback) {
        return value != null && value.isNumber() ? value.decimalValue() : fallback;
    }

    public record ItemResult(
            String code,
            String mode,
            String outcome,
            BigDecimal score,
            BigDecimal fullScore,
            String operator,
            JsonNode expected,
            JsonNode actual,
            String reason
    ) {
    }

    public record Result(
            List<ItemResult> items,
            BigDecimal score,
            BigDecimal fullScore,
            String outcome,
            String executionStatus
    ) {
    }
}
