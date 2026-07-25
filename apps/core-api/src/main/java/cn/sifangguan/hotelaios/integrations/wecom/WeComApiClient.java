package cn.sifangguan.hotelaios.integrations.wecom;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Minimal official WeCom HTTP client. Secrets and access tokens are never logged or persisted. */
@Service
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComApiClient {
    private static final URI API_BASE = URI.create("https://qyapi.weixin.qq.com");
    private final RestClient restClient;
    private final WeComProperties properties;
    private volatile CachedToken cachedToken;

    @Autowired
    public WeComApiClient(
            RestClient.Builder restClientBuilder,
            WeComProperties properties,
            @Value("${app.wecom.http.connect-timeout-ms:3000}") int connectTimeoutMs,
            @Value("${app.wecom.http.read-timeout-ms:5000}") int readTimeoutMs
    ) {
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Math.max(500, Math.min(connectTimeoutMs, 30000)));
        requestFactory.setReadTimeout(Math.max(1000, Math.min(readTimeoutMs, 60000)));
        restClientBuilder.requestFactory(requestFactory);
        this.restClient = restClientBuilder.baseUrl(API_BASE.toString()).build();
        this.properties = properties;
    }

    WeComApiClient(RestClient.Builder restClientBuilder, WeComProperties properties) {
        this.restClient = restClientBuilder.baseUrl(API_BASE.toString()).build();
        this.properties = properties;
    }

    public String exchangeOAuthCode(String authorizationCode) {
        return exchangeOAuthCode(required(authorizationCode, "authorization code"), false);
    }

    private String exchangeOAuthCode(String code, boolean retried) {
        try {
            URI uri = UriComponentsBuilder.fromPath("/cgi-bin/auth/getuserinfo")
                    .queryParam("access_token", accessToken())
                    .queryParam("code", code)
                    .build().encode().toUri();
            JsonNode response = get(uri, "OAuth member identity");
            return requiredResponse(response, "UserId", "userid");
        } catch (TokenExpiredException exception) {
            if (retried) throw new IllegalStateException("WeCom OAuth member identity failed after token refresh");
            cachedToken = null;
            return exchangeOAuthCode(code, true);
        }
    }

    public String sendApplicationTaskLink(String userId, String title, String description, URI deepLink) {
        return sendApplicationTaskLink(userId, title, description, deepLink, false);
    }

    private String sendApplicationTaskLink(
            String userId, String title, String description, URI deepLink, boolean retried
    ) {
        Map<String, Object> textCard = textCard(title, description, deepLink);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("touser", required(userId, "WeCom UserId"));
        payload.put("msgtype", "textcard");
        payload.put("agentid", properties.agentId());
        payload.put("textcard", textCard);
        URI uri = UriComponentsBuilder.fromPath("/cgi-bin/message/send")
                .queryParam("access_token", accessToken()).build().encode().toUri();
        JsonNode response;
        try {
            response = restClient.post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                    .body(payload).retrieve().body(JsonNode.class);
        } catch (RuntimeException exception) {
            throw sanitized("application message", exception);
        }
        try {
            requireSuccess(response, "application message");
        } catch (TokenExpiredException exception) {
            if (retried) throw new IllegalStateException("WeCom application message failed after token refresh");
            cachedToken = null;
            return sendApplicationTaskLink(userId, title, description, deepLink, true);
        }
        requireNoInvalidRecipients(response, "application message");
        String messageId = response.path("msgid").asText("");
        return messageId.isBlank() ? null : messageId;
    }

    /** Sends to an application chat that has already been allowlisted in wecom_chat_binding. */
    public String sendApplicationChatTaskLink(String chatId, String title, String description, URI deepLink) {
        return sendApplicationChatTaskLink(chatId, title, description, deepLink, false);
    }

    private String sendApplicationChatTaskLink(
            String chatId, String title, String description, URI deepLink, boolean retried
    ) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("chatid", required(chatId, "WeCom application chat id"));
        payload.put("msgtype", "textcard");
        payload.put("textcard", textCard(title, description, deepLink));
        URI uri = UriComponentsBuilder.fromPath("/cgi-bin/appchat/send")
                .queryParam("access_token", accessToken()).build().encode().toUri();
        JsonNode response;
        try {
            response = restClient.post().uri(uri).contentType(MediaType.APPLICATION_JSON)
                    .body(payload).retrieve().body(JsonNode.class);
        } catch (RuntimeException exception) {
            throw sanitized("application chat message", exception);
        }
        try {
            requireSuccess(response, "application chat message");
        } catch (TokenExpiredException exception) {
            if (retried) throw new IllegalStateException("WeCom application chat message failed after token refresh");
            cachedToken = null;
            return sendApplicationChatTaskLink(chatId, title, description, deepLink, true);
        }
        requireNoInvalidRecipients(response, "application chat message");
        String messageId = response.path("msgid").asText("");
        return messageId.isBlank() ? null : messageId;
    }

    private static Map<String, Object> textCard(String title, String description, URI deepLink) {
        Map<String, Object> textCard = new LinkedHashMap<>();
        textCard.put("title", title);
        textCard.put("description", description);
        textCard.put("url", deepLink.toString());
        textCard.put("btntxt", "打开处理中台");
        return textCard;
    }

    private String accessToken() {
        CachedToken current = cachedToken;
        Instant now = Instant.now();
        if (current != null && current.expiresAt().isAfter(now.plusSeconds(300))) return current.value();
        synchronized (this) {
            current = cachedToken;
            if (current != null && current.expiresAt().isAfter(Instant.now().plusSeconds(300))) return current.value();
            URI uri = UriComponentsBuilder.fromPath("/cgi-bin/gettoken")
                    .queryParam("corpid", properties.corpId())
                    .queryParam("corpsecret", properties.corpSecret())
                    .build().encode().toUri();
            JsonNode response = get(uri, "access token");
            String value = requiredResponse(response, "access_token");
            long expiresIn = response.path("expires_in").asLong(0);
            if (expiresIn < 1 || expiresIn > 86400) {
                throw new IllegalStateException("WeCom access token returned an invalid expires_in");
            }
            cachedToken = new CachedToken(value, Instant.now().plusSeconds(expiresIn));
            return value;
        }
    }

    private JsonNode get(URI uri, String operation) {
        JsonNode response;
        try {
            response = restClient.get().uri(uri).retrieve().body(JsonNode.class);
        } catch (RuntimeException exception) {
            throw sanitized(operation, exception);
        }
        requireSuccess(response, operation);
        return response;
    }

    private static void requireSuccess(JsonNode response, String operation) {
        if (response == null || !response.isObject()) {
            throw new IllegalStateException("WeCom " + operation + " returned an invalid response");
        }
        int errorCode = response.path("errcode").asInt(-1);
        if (errorCode != 0) {
            // Deliberately omit errmsg: providers sometimes echo request data.
            if (Set.of(40014, 42001).contains(errorCode)) throw new TokenExpiredException();
            throw new IllegalStateException("WeCom " + operation + " failed with errcode " + errorCode);
        }
    }

    private static void requireNoInvalidRecipients(JsonNode response, String operation) {
        if (!response.path("invaliduser").asText("").trim().isBlank()) {
            throw new IllegalStateException("WeCom " + operation + " rejected one or more recipients");
        }
    }

    private static String requiredResponse(JsonNode response, String... fields) {
        for (String field : fields) {
            String value = response.path(field).asText("").trim();
            if (!value.isBlank()) return value;
        }
        throw new IllegalStateException("WeCom response misses " + fields[0]);
    }

    private static String required(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + " is required");
        return value.trim();
    }

    private static IllegalStateException sanitized(String operation, RuntimeException exception) {
        // RestClient exceptions can contain the full query URI. Never retain
        // the cause because that URI includes corpsecret or access_token.
        return new IllegalStateException("WeCom " + operation + " request failed ("
                + exception.getClass().getSimpleName() + ")");
    }

    private record CachedToken(String value, Instant expiresAt) { }
    private static final class TokenExpiredException extends RuntimeException { }
}
