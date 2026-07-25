package cn.sifangguan.ota.contracts.connector;

import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * Adapter-owned allow-list for non-secret connector configuration. Policies must be obtained
 * from the trusted adapter registry; they are not accepted from an administrator request body.
 */
public record ConnectorConfigFieldPolicy(
        String policyCode,
        Set<String> textFields,
        Map<String, UrlFieldPolicy> urlFields) {

    private static final Set<String> FORBIDDEN_IDENTIFIER_FRAGMENTS = Set.of(
            "password", "passphrase", "secret", "token", "cookie", "credential",
            "authorization", "header", "webhook", "apikey", "connectionstring",
            "privatekey", "userinfo", "bearer", "session", "username", "loginname",
            "accesskey", "jdbcurl", "dsn");

    public ConnectorConfigFieldPolicy {
        policyCode = requireText(policyCode, "policyCode");
        textFields = Set.copyOf(Objects.requireNonNull(textFields, "textFields"));
        Objects.requireNonNull(urlFields, "urlFields");

        var safeUrlFields = new LinkedHashMap<String, UrlFieldPolicy>();
        for (var entry : urlFields.entrySet()) {
            var field = validateFieldName(entry.getKey(), "URL configuration field");
            safeUrlFields.put(
                    field,
                    Objects.requireNonNull(entry.getValue(), "URL field policy"));
        }
        urlFields = Map.copyOf(safeUrlFields);

        for (var field : textFields) {
            validateFieldName(field, "text configuration field");
            var normalized = normalize(field);
            if (normalized.endsWith("url") || normalized.endsWith("uri")) {
                throw new IllegalArgumentException(
                        "URL-like configuration field must use a URL field policy: " + field);
            }
            if (urlFields.containsKey(field)) {
                throw new IllegalArgumentException(
                        "configuration field cannot be both text and URL: " + field);
            }
        }
    }

    public boolean allowsText(String field) {
        return textFields.contains(field);
    }

    public boolean allowsUrl(String field) {
        return urlFields.containsKey(field);
    }

    public Set<String> allowedQueryParameters(String urlField) {
        var policy = urlFields.get(urlField);
        return policy == null ? Set.of() : policy.allowedQueryParameters();
    }

    public UrlFieldPolicy urlPolicy(String urlField) {
        var policy = urlFields.get(urlField);
        if (policy == null) {
            throw new IllegalArgumentException("URL field is not allowed by policy: " + urlField);
        }
        return policy;
    }

    static boolean isSensitiveIdentifier(String value) {
        var normalized = normalize(value);
        return FORBIDDEN_IDENTIFIER_FRAGMENTS.stream().anyMatch(normalized::contains);
    }

    private static String validateFieldName(String value, String description) {
        var field = requireText(value, description);
        if (isSensitiveIdentifier(field)) {
            throw new IllegalArgumentException(
                    "secret-bearing " + description + " is forbidden: " + field);
        }
        return field;
    }

    private static String normalize(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    public record UrlFieldPolicy(
            Set<String> allowedSchemes,
            Set<String> allowedHosts,
            Set<String> allowedQueryParameters) {

        public UrlFieldPolicy {
            allowedSchemes = normalizeSchemes(allowedSchemes);
            allowedHosts = normalizeHosts(allowedHosts);
            allowedQueryParameters = Set.copyOf(Objects.requireNonNull(
                    allowedQueryParameters, "allowedQueryParameters"));
            allowedQueryParameters.forEach(parameter ->
                    validateFieldName(parameter, "URL query parameter"));
        }

        public static UrlFieldPolicy httpsOnly(
                Set<String> allowedHosts,
                Set<String> allowedQueryParameters) {
            return new UrlFieldPolicy(Set.of("https"), allowedHosts, allowedQueryParameters);
        }

        public boolean allowsScheme(String scheme) {
            return allowedSchemes.contains(scheme.toLowerCase(Locale.ROOT));
        }

        public boolean allowsHost(String host) {
            return allowedHosts.contains(normalizeHost(host));
        }

        private static Set<String> normalizeSchemes(Set<String> schemes) {
            Objects.requireNonNull(schemes, "allowedSchemes");
            var normalized = schemes.stream()
                    .map(scheme -> requireText(scheme, "allowed URL scheme").toLowerCase(Locale.ROOT))
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());
            if (normalized.isEmpty()) {
                throw new IllegalArgumentException("at least one URL scheme must be allowed");
            }
            if (!Set.of("https", "http").containsAll(normalized)) {
                throw new IllegalArgumentException("only HTTP(S) URL schemes may be allowed");
            }
            return normalized;
        }

        private static Set<String> normalizeHosts(Set<String> hosts) {
            Objects.requireNonNull(hosts, "allowedHosts");
            var normalized = hosts.stream()
                    .map(UrlFieldPolicy::normalizeHost)
                    .collect(java.util.stream.Collectors.toUnmodifiableSet());
            if (normalized.isEmpty()) {
                throw new IllegalArgumentException("at least one exact URL host must be allowed");
            }
            return normalized;
        }

        private static String normalizeHost(String value) {
            var host = requireText(value, "allowed URL host").toLowerCase(Locale.ROOT);
            while (host.endsWith(".")) {
                host = host.substring(0, host.length() - 1);
            }
            if (host.isBlank()
                    || host.equals("localhost")
                    || host.endsWith(".localhost")
                    || host.contains(":")
                    || host.matches("[0-9.]+")
                    || host.matches("0x[0-9a-f]+")
                    || host.matches("(?:0x[0-9a-f]+|[0-9]+)(?:\\.(?:0x[0-9a-f]+|[0-9]+))*")
                    || !host.matches("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?")) {
                throw new IllegalArgumentException(
                        "IP, localhost, wildcard, or malformed URL host is forbidden: " + value);
            }
            return host;
        }
    }
}
