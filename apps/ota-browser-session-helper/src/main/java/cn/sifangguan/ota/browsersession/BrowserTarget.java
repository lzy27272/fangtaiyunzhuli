package cn.sifangguan.ota.browsersession;

import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.regex.Pattern;

public record BrowserTarget(
        String scheme,
        String host,
        int port,
        BrowserRequestMethod method,
        String path,
        Optional<BrowserRequestContract> requestContract) {

    private static final Pattern HOST_PATTERN =
            Pattern.compile("[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?");

    public BrowserTarget {
        Objects.requireNonNull(scheme, "scheme");
        Objects.requireNonNull(host, "host");
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(path, "path");
        Objects.requireNonNull(requestContract, "requestContract");

        var normalizedHost = host.toLowerCase(Locale.ROOT);
        if (!scheme.equals("https")
                || !host.equals(normalizedHost)
                || !HOST_PATTERN.matcher(host).matches()
                || host.contains("..")
                || host.contains("*")
                || host.contains("://")
                || host.contains(":")
                || isForbiddenHost(host)
                || port < 1
                || port > 65535) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_TARGET);
        }
        if (!path.startsWith("/")
                || path.contains("?")
                || path.contains("#")
                || path.contains("\\")
                || path.contains("//")
                || containsParentSegment(path)) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_TARGET);
        }
        if (method == BrowserRequestMethod.POST && requestContract.isEmpty()) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT);
        }
        if (method != BrowserRequestMethod.POST && requestContract.isPresent()) {
            throw new BrowserSessionPolicyException(
                    BrowserSessionErrorCode.INVALID_REQUEST_CONTRACT);
        }
    }

    public static BrowserTarget httpsGet(String host, String path) {
        return httpsGet(host, 443, path);
    }

    public static BrowserTarget httpsGet(String host, int port, String path) {
        return new BrowserTarget(
                "https",
                host,
                port,
                BrowserRequestMethod.GET,
                path,
                Optional.empty());
    }

    public static BrowserTarget httpsPost(
            String host,
            String path,
            BrowserRequestContract requestContract) {
        return httpsPost(host, 443, path, requestContract);
    }

    public static BrowserTarget httpsPost(
            String host,
            int port,
            String path,
            BrowserRequestContract requestContract) {
        return new BrowserTarget(
                "https",
                host,
                port,
                BrowserRequestMethod.POST,
                path,
                Optional.of(Objects.requireNonNull(
                        requestContract,
                        "requestContract")));
    }

    private static boolean isForbiddenHost(String host) {
        if (host.equals("localhost")
                || host.endsWith(".localhost")
                || host.equals("metadata")
                || host.equals("instance-data")
                || host.endsWith(".local")
                || host.endsWith(".internal")) {
            return true;
        }
        if (!host.chars().allMatch(character ->
                Character.isDigit(character) || character == '.')) {
            return false;
        }
        try {
            return !IpAddressClassifier.isPublicRoutable(host);
        } catch (BrowserSessionPolicyException exception) {
            return true;
        }
    }

    private static boolean containsParentSegment(String path) {
        for (var segment : path.split("/", -1)) {
            if (segment.equals("..") || segment.equals(".")) {
                return true;
            }
        }
        return false;
    }
}
