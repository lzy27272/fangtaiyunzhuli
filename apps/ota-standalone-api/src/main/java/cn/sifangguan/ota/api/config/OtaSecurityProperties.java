package cn.sifangguan.ota.api.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

@Validated
@ConfigurationProperties(prefix = "ota.security")
public class OtaSecurityProperties {
    private String issuer = "sifangguan-ota-standalone";
    private Duration accessTtl = Duration.ofMinutes(10);
    private Duration refreshTtl = Duration.ofHours(12);
    private String currentSigningKeyId = "ota-access-1";
    private String currentSigningSecretRef = "";
    private String previousSigningKeyId = "";
    private String previousSigningSecretRef = "";
    private Instant previousSigningKeyValidUntil;
    private final Cookie cookie = new Cookie();
    private final Login login = new Login();
    private final Cors cors = new Cors();
    private final Bootstrap bootstrap = new Bootstrap();

    public String getIssuer() {
        return issuer;
    }

    public void setIssuer(String issuer) {
        this.issuer = issuer;
    }

    public Duration getAccessTtl() {
        return accessTtl;
    }

    public void setAccessTtl(Duration accessTtl) {
        this.accessTtl = accessTtl;
    }

    public Duration getRefreshTtl() {
        return refreshTtl;
    }

    public void setRefreshTtl(Duration refreshTtl) {
        this.refreshTtl = refreshTtl;
    }

    public String getCurrentSigningKeyId() {
        return currentSigningKeyId;
    }

    public void setCurrentSigningKeyId(String currentSigningKeyId) {
        this.currentSigningKeyId = currentSigningKeyId;
    }

    public String getCurrentSigningSecretRef() {
        return currentSigningSecretRef;
    }

    public void setCurrentSigningSecretRef(String currentSigningSecretRef) {
        this.currentSigningSecretRef = currentSigningSecretRef;
    }

    public String getPreviousSigningKeyId() {
        return previousSigningKeyId;
    }

    public void setPreviousSigningKeyId(String previousSigningKeyId) {
        this.previousSigningKeyId = previousSigningKeyId;
    }

    public String getPreviousSigningSecretRef() {
        return previousSigningSecretRef;
    }

    public void setPreviousSigningSecretRef(String previousSigningSecretRef) {
        this.previousSigningSecretRef = previousSigningSecretRef;
    }

    public Instant getPreviousSigningKeyValidUntil() {
        return previousSigningKeyValidUntil;
    }

    public void setPreviousSigningKeyValidUntil(Instant previousSigningKeyValidUntil) {
        this.previousSigningKeyValidUntil = previousSigningKeyValidUntil;
    }

    public Cookie getCookie() {
        return cookie;
    }

    public Login getLogin() {
        return login;
    }

    public Cors getCors() {
        return cors;
    }

    public Bootstrap getBootstrap() {
        return bootstrap;
    }

    public static class Cookie {
        private String refreshName = "ota_refresh";
        private String csrfName = "ota_csrf";
        private boolean secure = true;
        private String sameSite = "Strict";
        private String refreshPath = "/api/v1/auth";
        private String csrfPath = "/";

        public String getRefreshName() {
            return refreshName;
        }

        public void setRefreshName(String refreshName) {
            this.refreshName = refreshName;
        }

        public String getCsrfName() {
            return csrfName;
        }

        public void setCsrfName(String csrfName) {
            this.csrfName = csrfName;
        }

        public boolean isSecure() {
            return secure;
        }

        public void setSecure(boolean secure) {
            this.secure = secure;
        }

        public String getSameSite() {
            return sameSite;
        }

        public void setSameSite(String sameSite) {
            this.sameSite = sameSite;
        }

        public String getRefreshPath() {
            return refreshPath;
        }

        public void setRefreshPath(String refreshPath) {
            this.refreshPath = refreshPath;
        }

        public String getCsrfPath() {
            return csrfPath;
        }

        public void setCsrfPath(String csrfPath) {
            this.csrfPath = csrfPath;
        }
    }

    public static class Login {
        private int maxFailures = 5;
        private Duration lockDuration = Duration.ofMinutes(15);

        public int getMaxFailures() {
            return maxFailures;
        }

        public void setMaxFailures(int maxFailures) {
            this.maxFailures = maxFailures;
        }

        public Duration getLockDuration() {
            return lockDuration;
        }

        public void setLockDuration(Duration lockDuration) {
            this.lockDuration = lockDuration;
        }
    }

    public static class Cors {
        private List<String> allowedOrigins = new ArrayList<>();

        public List<String> getAllowedOrigins() {
            return List.copyOf(allowedOrigins);
        }

        public void setAllowedOrigins(List<String> allowedOrigins) {
            this.allowedOrigins = new ArrayList<>(allowedOrigins);
        }
    }

    public static class Bootstrap {
        private boolean enabled;
        private String confirmation = "";
        private String username = "";
        private String displayName = "";
        private String passwordSecretRef = "";

        public boolean isEnabled() {
            return enabled;
        }

        public void setEnabled(boolean enabled) {
            this.enabled = enabled;
        }

        public String getConfirmation() {
            return confirmation;
        }

        public void setConfirmation(String confirmation) {
            this.confirmation = confirmation;
        }

        public String getUsername() {
            return username;
        }

        public void setUsername(String username) {
            this.username = username;
        }

        public String getDisplayName() {
            return displayName;
        }

        public void setDisplayName(String displayName) {
            this.displayName = displayName;
        }

        public String getPasswordSecretRef() {
            return passwordSecretRef;
        }

        public void setPasswordSecretRef(String passwordSecretRef) {
            this.passwordSecretRef = passwordSecretRef;
        }
    }
}
