package cn.sifangguan.ota.browsersession;

import java.util.Collection;
import java.util.Objects;
import java.util.Set;

public final class NonSecretConfigurationSchema {
    private static final Set<String> SERVER_OWNED_ALLOWED_KEYS = Set.of(
            "approvedTargetSetVersion",
            "hotelExternalId",
            "pollIntervalSeconds",
            "providerCode");

    private NonSecretConfigurationSchema() {
    }

    public static NonSecretConfigurationSchema browserSessionHelperSchema() {
        return new NonSecretConfigurationSchema();
    }

    public Set<String> allowedKeys() {
        return SERVER_OWNED_ALLOWED_KEYS;
    }

    public void assertDeclaredKeys(Collection<String> configurationKeys) {
        Objects.requireNonNull(configurationKeys, "configurationKeys");
        for (var key : configurationKeys) {
            Objects.requireNonNull(key, "configuration key");
            if (!SERVER_OWNED_ALLOWED_KEYS.contains(key)) {
                throw new BrowserSessionPolicyException(
                        BrowserSessionErrorCode.UNKNOWN_CONFIGURATION_KEY);
            }
        }
    }
}
