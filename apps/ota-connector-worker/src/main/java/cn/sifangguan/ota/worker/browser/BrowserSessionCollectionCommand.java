package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.port.SecretStorePort.SecretReference;

import java.net.URI;
import java.net.URISyntaxException;
import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Privacy-minimized command sent from the Worker to an isolated browser helper.
 *
 * <p>The session value is an opaque SecretStore locator, never browser credential material.
 */
public record BrowserSessionCollectionCommand(
        CollectionRequest request,
        UUID actorAccountId,
        UUID authorizationAttemptId,
        UUID connectorVersionId,
        String connectorCode,
        String adapterVersion,
        SecretReference sessionReference,
        long secretBindingVersion,
        String secretProviderCode,
        String approvedOperationCode,
        Instant deadline) {

    private static final Map<String, String> REFERENCE_SCHEME_BY_PROVIDER =
            Map.of(
                    "VAULT", "vault",
                    "OSKEYRING", "oskeyring",
                    "SECRETSTORE", "secretstore");
    private static final Pattern SAFE_CODE = Pattern.compile("[A-Z][A-Z0-9_]{1,63}");
    private static final Pattern SAFE_VERSION =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._+-]{0,63}");

    public BrowserSessionCollectionCommand {
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(actorAccountId, "actorAccountId");
        Objects.requireNonNull(
                authorizationAttemptId,
                "authorizationAttemptId");
        Objects.requireNonNull(connectorVersionId, "connectorVersionId");
        connectorCode = requireSafeCode(connectorCode, "connectorCode");
        adapterVersion = requireSafeVersion(adapterVersion);
        Objects.requireNonNull(sessionReference, "sessionReference");
        if (request.configVersion() < 1) {
            throw new IllegalArgumentException("request.configVersion must be positive");
        }
        if (secretBindingVersion < 1) {
            throw new IllegalArgumentException("secretBindingVersion must be positive");
        }
        secretProviderCode = requireSafeCode(
                secretProviderCode,
                "secretProviderCode");
        approvedOperationCode = requireSafeCode(
                approvedOperationCode,
                "approvedOperationCode");
        Objects.requireNonNull(deadline, "deadline");

        if (!request.scope().tenantId().equals(sessionReference.tenantId())
                || !request.scope().hotelId().equals(sessionReference.hotelId())
                || !request.connectorId().equals(sessionReference.connectorId())) {
            throw new IllegalArgumentException(
                    "browser session reference scope must match the collection request");
        }
        if (!"BROWSER_SESSION".equals(sessionReference.purpose())) {
            throw new IllegalArgumentException(
                    "browser session reference purpose must be BROWSER_SESSION");
        }
        validateSecretProviderReference(
                secretProviderCode,
                sessionReference.opaqueRef());

        var latestDeadline = request.cutoffAt().plus(request.timeout());
        if (!deadline.isAfter(request.cutoffAt()) || deadline.isAfter(latestDeadline)) {
            throw new IllegalArgumentException(
                    "browser helper deadline must stay inside the collection timeout");
        }
    }

    static String requireSafeCode(String value, String field) {
        Objects.requireNonNull(value, field);
        if (!SAFE_CODE.matcher(value).matches()) {
            throw new IllegalArgumentException(field + " must be a stable uppercase code");
        }
        return value;
    }

    @Override
    public String toString() {
        return "BrowserSessionCollectionCommand["
                + "scope=<redacted>"
                + ", actorAccountId=<redacted>"
                + ", authorizationAttemptId=<redacted>"
                + ", connectorVersionId=<redacted>"
                + ", configVersion=" + request.configVersion()
                + ", connectorCode=" + connectorCode
                + ", adapterVersion=" + adapterVersion
                + ", sessionReference=<redacted>"
                + ", secretBindingVersion=" + secretBindingVersion
                + ", secretProviderCode=" + secretProviderCode
                + ", approvedOperationCode=" + approvedOperationCode
                + ", deadline=<redacted>]";
    }

    static String requireSafeVersion(String value) {
        Objects.requireNonNull(value, "adapterVersion");
        if (!SAFE_VERSION.matcher(value).matches()) {
            throw new IllegalArgumentException(
                    "adapterVersion must be a stable non-secret version");
        }
        return value;
    }

    static void validateSecretProviderReference(
            String secretProviderCode,
            String opaqueReference) {
        var expectedScheme = REFERENCE_SCHEME_BY_PROVIDER.get(
                Objects.requireNonNull(
                        secretProviderCode,
                        "secretProviderCode"));
        var actualScheme = validateOpaqueReference(opaqueReference);
        if (expectedScheme == null || !expectedScheme.equals(actualScheme)) {
            throw new IllegalArgumentException(
                    "secretProviderCode must match the opaque reference scheme");
        }
    }

    private static String validateOpaqueReference(String value) {
        Objects.requireNonNull(value, "browser session reference");
        if (value.length() > 512
                || value.indexOf('=') >= 0
                || value.indexOf(';') >= 0
                || value.chars().anyMatch(Character::isWhitespace)) {
            throw new IllegalArgumentException(
                    "browser session reference must be an opaque SecretStore locator");
        }

        final URI uri;
        try {
            uri = new URI(value);
        } catch (URISyntaxException ignored) {
            throw new IllegalArgumentException(
                    "browser session reference must be a valid opaque locator");
        }

        var scheme = Objects.requireNonNullElse(uri.getScheme(), "")
                .toLowerCase(Locale.ROOT);
        if (!REFERENCE_SCHEME_BY_PROVIDER.containsValue(scheme)
                || uri.getRawAuthority() == null
                || uri.getRawAuthority().isBlank()
                || uri.getHost() == null
                || uri.getPort() != -1
                || uri.getRawPath() == null
                || uri.getRawPath().isBlank()
                || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null) {
            throw new IllegalArgumentException(
                    "browser session reference must use an approved SecretStore scheme");
        }
        return scheme;
    }
}
