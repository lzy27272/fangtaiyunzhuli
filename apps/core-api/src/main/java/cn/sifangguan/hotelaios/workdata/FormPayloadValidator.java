package cn.sifangguan.hotelaios.workdata;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Deterministic JSON Schema subset used by Sprint 2 forms. Unsupported
 * keywords are ignored, while the supported structural and value constraints
 * are enforced before a work record can be submitted.
 */
@Component
public class FormPayloadValidator {
    private static final Set<String> SUPPORTED_KEYWORDS = Set.of(
            "$schema", "$id", "title", "description", "default", "examples",
            "type", "enum", "required", "properties", "additionalProperties", "items",
            "minItems", "maxItems", "minLength", "maxLength", "pattern",
            "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"
    );

    public void requireValid(JsonNode schema, JsonNode payload) {
        requireSupportedSchema(schema, "$");
        List<String> issues = new ArrayList<>();
        validate(schema, payload, "$", issues);
        if (!issues.isEmpty()) {
            throw new IllegalArgumentException("表单数据不符合已发布Schema: " + String.join("；", issues));
        }
    }

    public void requireValidDraft(JsonNode schema, JsonNode payload) {
        requireSupportedSchema(schema, "$");
        JsonNode relaxed = schema.deepCopy();
        removeRequired(relaxed);
        List<String> issues = new ArrayList<>();
        validate(relaxed, payload, "$", issues);
        if (!issues.isEmpty()) {
            throw new IllegalArgumentException("草稿数据不符合已发布Schema: " + String.join("；", issues));
        }
    }

    private void removeRequired(JsonNode schema) {
        if (schema == null || !schema.isObject()) return;
        ((com.fasterxml.jackson.databind.node.ObjectNode) schema).remove("required");
        JsonNode properties = schema.path("properties");
        if (properties.isObject()) {
            properties.forEach(this::removeRequired);
        }
        JsonNode items = schema.path("items");
        if (items.isObject()) removeRequired(items);
    }

    private void requireSupportedSchema(JsonNode schema, String path) {
        if (schema == null || !schema.isObject()) {
            throw new IllegalArgumentException("表单Schema节点必须是对象: " + path);
        }
        schema.fieldNames().forEachRemaining(keyword -> {
            if (!SUPPORTED_KEYWORDS.contains(keyword)) {
                throw new IllegalArgumentException("表单Schema包含Sprint 2未支持的关键字: " + path + "." + keyword);
            }
        });
        JsonNode properties = schema.path("properties");
        if (!properties.isMissingNode()) {
            if (!properties.isObject()) {
                throw new IllegalArgumentException("properties必须是对象: " + path);
            }
            properties.fields().forEachRemaining(entry ->
                    requireSupportedSchema(entry.getValue(), path + ".properties." + entry.getKey()));
        }
        JsonNode items = schema.path("items");
        if (!items.isMissingNode()) {
            requireSupportedSchema(items, path + ".items");
        }
        JsonNode additionalProperties = schema.path("additionalProperties");
        if (!additionalProperties.isMissingNode() && !additionalProperties.isBoolean()) {
            throw new IllegalArgumentException("Sprint 2仅支持布尔型additionalProperties: " + path);
        }
    }

    private void validate(JsonNode schema, JsonNode value, String path, List<String> issues) {
        if (schema == null || schema.isMissingNode() || schema.isNull()) {
            return;
        }
        String type = schema.path("type").asText("");
        if (!type.isBlank() && !matchesType(type, value)) {
            issues.add(path + " 应为 " + type);
            return;
        }
        JsonNode enumValues = schema.path("enum");
        if (enumValues.isArray()) {
            boolean matched = false;
            for (JsonNode allowed : enumValues) {
                if (allowed.equals(value)) {
                    matched = true;
                    break;
                }
            }
            if (!matched) {
                issues.add(path + " 不在允许值范围内");
            }
        }
        if (value != null && value.isObject()) {
            validateObject(schema, value, path, issues);
        } else if (value != null && value.isArray()) {
            validateArray(schema, value, path, issues);
        } else if (value != null && value.isTextual()) {
            validateString(schema, value.asText(), path, issues);
        } else if (value != null && value.isNumber()) {
            validateNumber(schema, value.decimalValue(), path, issues);
        }
    }

    private void validateObject(JsonNode schema, JsonNode value, String path, List<String> issues) {
        JsonNode required = schema.path("required");
        if (required.isArray()) {
            for (JsonNode field : required) {
                String name = field.asText();
                if (!value.has(name) || value.get(name).isNull()) {
                    issues.add(path + "." + name + " 为必填项");
                }
            }
        }
        JsonNode properties = schema.path("properties");
        if (properties.isObject()) {
            properties.fields().forEachRemaining(entry -> {
                if (value.has(entry.getKey())) {
                    validate(entry.getValue(), value.get(entry.getKey()), path + "." + entry.getKey(), issues);
                }
            });
            if (schema.path("additionalProperties").isBoolean()
                    && !schema.path("additionalProperties").asBoolean()) {
                value.fieldNames().forEachRemaining(name -> {
                    if (!properties.has(name)) {
                        issues.add(path + "." + name + " 不是允许字段");
                    }
                });
            }
        }
    }

    private void validateArray(JsonNode schema, JsonNode value, String path, List<String> issues) {
        int size = value.size();
        if (schema.has("minItems") && size < schema.path("minItems").asInt()) {
            issues.add(path + " 项目数少于 " + schema.path("minItems").asInt());
        }
        if (schema.has("maxItems") && size > schema.path("maxItems").asInt()) {
            issues.add(path + " 项目数超过 " + schema.path("maxItems").asInt());
        }
        JsonNode itemSchema = schema.path("items");
        if (!itemSchema.isMissingNode()) {
            for (int index = 0; index < size; index++) {
                validate(itemSchema, value.get(index), path + "[" + index + "]", issues);
            }
        }
    }

    private void validateString(JsonNode schema, String value, String path, List<String> issues) {
        if (schema.has("minLength") && value.length() < schema.path("minLength").asInt()) {
            issues.add(path + " 长度不足");
        }
        if (schema.has("maxLength") && value.length() > schema.path("maxLength").asInt()) {
            issues.add(path + " 长度超限");
        }
        if (schema.hasNonNull("pattern")) {
            try {
                if (!Pattern.compile(schema.path("pattern").asText()).matcher(value).find()) {
                    issues.add(path + " 格式不正确");
                }
            } catch (PatternSyntaxException exception) {
                throw new IllegalArgumentException("表单Schema包含无效正则表达式: " + path);
            }
        }
    }

    private void validateNumber(JsonNode schema, BigDecimal value, String path, List<String> issues) {
        if (schema.has("minimum") && value.compareTo(schema.path("minimum").decimalValue()) < 0) {
            issues.add(path + " 小于最小值 " + schema.path("minimum").asText());
        }
        if (schema.has("maximum") && value.compareTo(schema.path("maximum").decimalValue()) > 0) {
            issues.add(path + " 超过最大值 " + schema.path("maximum").asText());
        }
        if (schema.has("exclusiveMinimum")
                && value.compareTo(schema.path("exclusiveMinimum").decimalValue()) <= 0) {
            issues.add(path + " 必须大于 " + schema.path("exclusiveMinimum").asText());
        }
        if (schema.has("exclusiveMaximum")
                && value.compareTo(schema.path("exclusiveMaximum").decimalValue()) >= 0) {
            issues.add(path + " 必须小于 " + schema.path("exclusiveMaximum").asText());
        }
    }

    private boolean matchesType(String type, JsonNode value) {
        if (value == null) {
            return false;
        }
        return switch (type) {
            case "object" -> value.isObject();
            case "array" -> value.isArray();
            case "string" -> value.isTextual();
            case "integer" -> value.isIntegralNumber();
            case "number" -> value.isNumber();
            case "boolean" -> value.isBoolean();
            case "null" -> value.isNull();
            default -> true;
        };
    }
}
