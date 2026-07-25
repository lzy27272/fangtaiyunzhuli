package cn.sifangguan.hotelaios.integrations.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

/** Strict envelope and identity-field parser for the newer WeCom AI-bot JSON callback. */
@Component
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComJson {
    private final ObjectMapper objectMapper;
    private final WeComProperties properties;

    public WeComJson(ObjectMapper objectMapper, WeComProperties properties) {
        this.objectMapper = objectMapper;
        this.properties = properties;
    }

    public String encryptedEnvelope(String json) {
        JsonNode root = object(json, "WeCom encrypted callback");
        return required(root, "encrypt");
    }

    public WeComInboundMessage parseCallback(String json) {
        JsonNode root = object(json, "WeCom callback payload");
        String messageId = required(root, "msgid");
        String msgType = required(root, "msgtype");
        String botId = required(root, "aibotid");
        if (!botId.equals(properties.botId())) {
            throw new IllegalArgumentException("WeCom callback bot id does not match this deployment");
        }
        JsonNode from = root.path("from");
        if (!from.isObject()) throw new IllegalArgumentException("WeCom callback from must be an object");
        String userId = required(from, "userid");
        String senderCorpId = optional(from, "corpid");
        if (senderCorpId != null && !senderCorpId.equals(properties.corpId())) {
            throw new IllegalArgumentException("WeCom callback sender CorpId does not match this deployment");
        }
        String receiptType = msgType.toUpperCase(Locale.ROOT);
        String eventKey = null;
        String taskId = null;
        if ("event".equalsIgnoreCase(msgType)) {
            JsonNode event = root.path("event");
            if (!event.isObject()) throw new IllegalArgumentException("WeCom event callback misses event object");
            receiptType = required(event, "eventtype").toUpperCase(Locale.ROOT);
            eventKey = optional(event, "event_key");
            taskId = optional(event, "task_id");
        }
        Map<String, String> fields = new LinkedHashMap<>();
        put(fields, "chatid", optional(root, "chatid"));
        put(fields, "chattype", optional(root, "chattype"));
        put(fields, "aibotid", botId);
        put(fields, "taskid", taskId);
        return new WeComInboundMessage(messageId, receiptType, userId, eventKey,
                sha256(json), Map.copyOf(fields));
    }

    public String encryptedResponse(String encrypted, String signature, String timestamp, String nonce) {
        try {
            return objectMapper.writeValueAsString(Map.of(
                    "encrypt", encrypted,
                    "msgsignature", signature,
                    "timestamp", timestamp,
                    "nonce", nonce
            ));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to encode WeCom callback response");
        }
    }

    private JsonNode object(String json, String label) {
        if (json == null || json.isBlank() || json.length() > 1024 * 1024) {
            throw new IllegalArgumentException(label + " is empty or too large");
        }
        try {
            JsonNode node = objectMapper.readTree(json);
            if (node == null || !node.isObject()) throw new IllegalArgumentException(label + " must be a JSON object");
            return node;
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException(label + " is invalid JSON", exception);
        }
    }

    private static String required(JsonNode node, String field) {
        String value = optional(node, field);
        if (value == null) throw new IllegalArgumentException("WeCom callback misses " + field);
        return value;
    }

    private static String optional(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull() || (!value.isTextual() && !value.isNumber())) return null;
        String result = value.asText().trim();
        return result.isBlank() ? null : result;
    }

    private static void put(Map<String, String> target, String key, String value) {
        if (value != null) target.put(key, value);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable");
        }
    }

}
