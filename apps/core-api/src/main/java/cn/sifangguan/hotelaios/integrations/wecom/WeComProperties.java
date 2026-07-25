package cn.sifangguan.hotelaios.integrations.wecom;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.time.Duration;
import java.util.UUID;

/** Fail-closed WeCom configuration. The bean does not exist while the feature is disabled. */
@Component
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComProperties {
    private final UUID tenantId;
    private final String corpId;
    private final long agentId;
    private final String corpSecret;
    private final String callbackToken;
    private final String callbackAesKey;
    private final String botId;
    private final String botReceiveId;
    private final URI frontendBaseUrl;
    private final URI oauthCallbackUrl;
    private final Duration stateTtl;
    private final Duration exchangeTtl;
    private final Duration sessionTtl;
    private final int oauthPendingLimit;

    public WeComProperties(
            @Value("${app.wecom.tenant-id:}") String tenantId,
            @Value("${app.wecom.corp-id:}") String corpId,
            @Value("${app.wecom.agent-id:}") String agentId,
            @Value("${app.wecom.corp-secret:}") String corpSecret,
            @Value("${app.wecom.callback-token:}") String callbackToken,
            @Value("${app.wecom.callback-aes-key:}") String callbackAesKey,
            @Value("${app.wecom.bot-id:}") String botId,
            @Value("${app.wecom.bot-receive-id:}") String botReceiveId,
            @Value("${app.wecom.frontend-base-url:http://localhost:5173}") String frontendBaseUrl,
            @Value("${app.wecom.oauth-callback-url:}") String oauthCallbackUrl,
            @Value("${app.wecom.oauth.state-ttl-minutes:10}") long stateTtlMinutes,
            @Value("${app.wecom.oauth.exchange-ttl-minutes:2}") long exchangeTtlMinutes,
            @Value("${app.wecom.oauth.session-ttl-minutes:30}") long sessionTtlMinutes,
            @Value("${app.wecom.oauth.pending-limit:500}") int oauthPendingLimit
    ) {
        this.tenantId = parseUuid(tenantId);
        this.corpId = required(corpId, "WECOM_CORP_ID");
        this.agentId = parsePositiveLong(agentId, "WECOM_AGENT_ID");
        this.corpSecret = required(corpSecret, "WECOM_CORP_SECRET");
        this.callbackToken = required(callbackToken, "WECOM_CALLBACK_TOKEN");
        this.callbackAesKey = required(callbackAesKey, "WECOM_CALLBACK_AES_KEY");
        this.botId = required(botId, "WECOM_BOT_ID");
        this.botReceiveId = required(botReceiveId, "WECOM_BOT_RECEIVE_ID");
        this.frontendBaseUrl = URI.create(required(frontendBaseUrl, "WECOM_FRONTEND_BASE_URL"));
        this.oauthCallbackUrl = URI.create(required(oauthCallbackUrl, "WECOM_OAUTH_CALLBACK_URL"));
        this.stateTtl = Duration.ofMinutes(bounded(stateTtlMinutes, 1, 30, "state TTL"));
        this.exchangeTtl = Duration.ofMinutes(bounded(exchangeTtlMinutes, 1, 10, "exchange TTL"));
        this.sessionTtl = Duration.ofMinutes(bounded(sessionTtlMinutes, 5, 120, "session TTL"));
        this.oauthPendingLimit = (int) bounded(oauthPendingLimit, 10, 5000, "OAuth pending limit");
    }

    @PostConstruct
    void validate() {
        if (callbackAesKey.length() != 43) {
            throw new IllegalStateException("WECOM_CALLBACK_AES_KEY must contain exactly 43 Base64 characters");
        }
        if (!"https".equalsIgnoreCase(frontendBaseUrl.getScheme())
                && !"localhost".equalsIgnoreCase(frontendBaseUrl.getHost())
                && !"127.0.0.1".equals(frontendBaseUrl.getHost())) {
            throw new IllegalStateException("WECOM_FRONTEND_BASE_URL must use HTTPS outside localhost");
        }
        if (frontendBaseUrl.getRawQuery() != null || frontendBaseUrl.getRawFragment() != null) {
            throw new IllegalStateException("WECOM_FRONTEND_BASE_URL cannot contain query or fragment");
        }
        if (!"https".equalsIgnoreCase(oauthCallbackUrl.getScheme())) {
            throw new IllegalStateException("WECOM_OAUTH_CALLBACK_URL must use HTTPS");
        }
        if (oauthCallbackUrl.getRawQuery() != null || oauthCallbackUrl.getRawFragment() != null) {
            throw new IllegalStateException("WECOM_OAUTH_CALLBACK_URL cannot contain query or fragment");
        }
    }

    public UUID tenantId() { return tenantId; }
    public String corpId() { return corpId; }
    public long agentId() { return agentId; }
    public String corpSecret() { return corpSecret; }
    public String callbackToken() { return callbackToken; }
    public String callbackAesKey() { return callbackAesKey; }
    public String botId() { return botId; }
    public String botReceiveId() { return botReceiveId; }
    public URI frontendBaseUrl() { return frontendBaseUrl; }
    public URI oauthCallbackUrl() { return oauthCallbackUrl; }
    public Duration stateTtl() { return stateTtl; }
    public Duration exchangeTtl() { return exchangeTtl; }
    public Duration sessionTtl() { return sessionTtl; }
    public int oauthPendingLimit() { return oauthPendingLimit; }

    private static UUID parseUuid(String value) {
        try {
            return UUID.fromString(required(value, "WECOM_TENANT_ID"));
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("WECOM_TENANT_ID must be a UUID", exception);
        }
    }

    private static String required(String value, String name) {
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required when WeCom is enabled");
        return value.trim();
    }

    private static long bounded(long value, long min, long max, String label) {
        if (value < min || value > max) throw new IllegalStateException(label + " must be between " + min + " and " + max + " minutes");
        return value;
    }

    private static long parsePositiveLong(String value, String name) {
        try {
            long result = Long.parseLong(required(value, name));
            if (result < 1) throw new NumberFormatException("not positive");
            return result;
        } catch (NumberFormatException exception) {
            throw new IllegalStateException(name + " must be a positive integer", exception);
        }
    }
}
