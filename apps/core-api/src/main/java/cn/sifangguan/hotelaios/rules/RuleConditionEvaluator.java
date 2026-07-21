package cn.sifangguan.hotelaios.rules;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Component
public class RuleConditionEvaluator {
    private static final int MAX_DEPTH = 20;

    public Evaluation evaluate(JsonNode condition, JsonNode facts) {
        List<String> trace = new ArrayList<>();
        boolean matched = evaluateNode(condition, facts, trace, 0, "$condition");
        return new Evaluation(matched, List.copyOf(trace));
    }

    public void validate(JsonNode condition) {
        evaluate(condition, com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode());
    }

    private boolean evaluateNode(JsonNode node, JsonNode facts, List<String> trace, int depth, String location) {
        if (depth > MAX_DEPTH) {
            throw new IllegalArgumentException("规则条件嵌套超过" + MAX_DEPTH + "层");
        }
        if (node == null || !node.isObject()) {
            throw new IllegalArgumentException(location + "必须是对象");
        }
        String op = node.path("op").asText().toUpperCase(Locale.ROOT);
        boolean result;
        switch (op) {
            case "ALL", "ANY" -> {
                JsonNode children = node.path("children");
                if (!children.isArray() || children.isEmpty()) {
                    throw new IllegalArgumentException(location + ".children必须是非空数组");
                }
                result = "ALL".equals(op);
                for (int index = 0; index < children.size(); index++) {
                    boolean child = evaluateNode(children.get(index), facts, trace, depth + 1,
                            location + ".children[" + index + "]");
                    result = "ALL".equals(op) ? result && child : result || child;
                }
            }
            case "NOT" -> result = !evaluateNode(node.get("child"), facts, trace, depth + 1, location + ".child");
            case "EXISTS" -> result = !fact(facts, requiredFact(node, location)).isMissingNode();
            case "EQ", "NE", "GT", "GTE", "LT", "LTE", "IN" -> {
                JsonNode actual = fact(facts, requiredFact(node, location));
                JsonNode expected = node.get("value");
                if (expected == null) {
                    throw new IllegalArgumentException(location + ".value不能为空");
                }
                result = compare(op, actual, expected);
            }
            default -> throw new IllegalArgumentException(location + "包含不支持的操作符: " + op);
        }
        trace.add(location + " " + op + " => " + result);
        return result;
    }

    private String requiredFact(JsonNode node, String location) {
        String path = node.path("fact").asText();
        if (path.isBlank() || path.contains("[") || path.contains("]")) {
            throw new IllegalArgumentException(location + ".fact必须是点分隔字段路径");
        }
        return path;
    }

    private JsonNode fact(JsonNode facts, String path) {
        JsonNode current = facts;
        for (String segment : path.split("\\.")) {
            if (current == null || !current.isObject() || !current.has(segment)) {
                return com.fasterxml.jackson.databind.node.MissingNode.getInstance();
            }
            current = current.get(segment);
        }
        return current;
    }

    private boolean compare(String op, JsonNode actual, JsonNode expected) {
        if (actual == null || actual.isMissingNode()) {
            return "NE".equals(op) && !expected.isNull();
        }
        return switch (op) {
            case "EQ" -> actual.equals(expected);
            case "NE" -> !actual.equals(expected);
            case "IN" -> {
                if (!expected.isArray()) {
                    throw new IllegalArgumentException("IN操作符的value必须是数组");
                }
                boolean found = false;
                for (JsonNode candidate : expected) {
                    found |= actual.equals(candidate);
                }
                yield found;
            }
            case "GT", "GTE", "LT", "LTE" -> numeric(op, actual, expected);
            default -> false;
        };
    }

    private boolean numeric(String op, JsonNode actual, JsonNode expected) {
        if (!actual.isNumber() || !expected.isNumber()) {
            return false;
        }
        BigDecimal left = actual.decimalValue();
        BigDecimal right = expected.decimalValue();
        int compared = left.compareTo(right);
        return switch (op) {
            case "GT" -> compared > 0;
            case "GTE" -> compared >= 0;
            case "LT" -> compared < 0;
            case "LTE" -> compared <= 0;
            default -> false;
        };
    }

    public record Evaluation(boolean matched, List<String> trace) {
    }
}
