package cn.sifangguan.ota.browsersession;

import java.util.Objects;
import java.util.Set;

public record BrowserHopAuthorizationRequest(
        BrowserSessionBinding binding,
        BrowserTarget target,
        Set<ResolvedNetworkAddress> resolvedAddresses,
        int hopIndex) {

    public BrowserHopAuthorizationRequest {
        Objects.requireNonNull(binding, "binding");
        Objects.requireNonNull(target, "target");
        resolvedAddresses = Set.copyOf(
                Objects.requireNonNull(resolvedAddresses, "resolvedAddresses"));
        if (hopIndex < 0) {
            throw new IllegalArgumentException("hopIndex must be non-negative");
        }
    }
}
