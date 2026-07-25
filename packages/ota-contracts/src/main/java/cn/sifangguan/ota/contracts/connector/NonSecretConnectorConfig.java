package cn.sifangguan.ota.contracts.connector;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

public record NonSecretConnectorConfig(
        UUID connectorId,
        long configVersion,
        ConnectorConfigFieldPolicy fieldPolicy,
        Map<String, String> values) {

    public NonSecretConnectorConfig {
        Objects.requireNonNull(connectorId, "connectorId");
        if (configVersion < 1) {
            throw new IllegalArgumentException("configVersion must be positive");
        }
        Objects.requireNonNull(fieldPolicy, "fieldPolicy");
        Objects.requireNonNull(values, "values");
        var safeCopy = new LinkedHashMap<String, String>();
        values.forEach((key, value) -> {
            var validatedKey = requireText(key, "configuration key");
            var validatedValue = requireText(value, "configuration value");
            if (fieldPolicy.allowsUrl(validatedKey)) {
                validateUrl(validatedKey, validatedValue, fieldPolicy);
            } else if (!fieldPolicy.allowsText(validatedKey)) {
                throw new IllegalArgumentException(
                        "configuration field is not allowed by policy "
                                + fieldPolicy.policyCode() + ": " + validatedKey);
            }
            safeCopy.put(validatedKey, validatedValue);
        });
        values = Map.copyOf(safeCopy);
    }

    private static void validateUrl(
            String field,
            String value,
            ConnectorConfigFieldPolicy policy) {
        final URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("invalid URL configuration field: " + field, exception);
        }

        var scheme = uri.getScheme();
        if (!uri.isAbsolute()
                || scheme == null
                || !(scheme.equalsIgnoreCase("https") || scheme.equalsIgnoreCase("http"))
                || uri.getHost() == null) {
            throw new IllegalArgumentException(
                    "URL configuration field must be an absolute HTTP(S) URL with a host: " + field);
        }
        if (uri.getRawUserInfo() != null) {
            throw new IllegalArgumentException("URL userinfo is forbidden: " + field);
        }
        if (uri.getRawFragment() != null) {
            throw new IllegalArgumentException("URL fragments are forbidden: " + field);
        }

        var urlPolicy = policy.urlPolicy(field);
        if (!urlPolicy.allowsScheme(scheme)) {
            throw new IllegalArgumentException(
                    "URL scheme is not allowed by policy " + policy.policyCode() + ": " + scheme);
        }
        if (!urlPolicy.allowsHost(uri.getHost())) {
            throw new IllegalArgumentException(
                    "URL host is not allowed by policy " + policy.policyCode() + ": " + uri.getHost());
        }

        var rawQuery = uri.getRawQuery();
        if (rawQuery == null || rawQuery.isBlank()) {
            return;
        }
        var allowedParameters = urlPolicy.allowedQueryParameters();
        for (var part : rawQuery.split("&", -1)) {
            if (part.isBlank()) {
                throw new IllegalArgumentException("blank URL query component is forbidden: " + field);
            }
            var separator = part.indexOf('=');
            var rawName = separator >= 0 ? part.substring(0, separator) : part;
            var name = URLDecoder.decode(rawName, StandardCharsets.UTF_8);
            if (ConnectorConfigFieldPolicy.isSensitiveIdentifier(name)) {
                throw new IllegalArgumentException(
                        "sensitive URL query parameter is forbidden in " + field + ": " + name);
            }
            if (!allowedParameters.contains(name)) {
                throw new IllegalArgumentException(
                        "URL query parameter is not allowed by policy "
                                + policy.policyCode() + " for " + field + ": " + name);
            }
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
