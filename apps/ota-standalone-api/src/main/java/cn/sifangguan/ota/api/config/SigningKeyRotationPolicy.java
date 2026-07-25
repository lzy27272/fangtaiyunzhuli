package cn.sifangguan.ota.api.config;

import java.time.Duration;
import java.time.Instant;

final class SigningKeyRotationPolicy {
    private static final Duration CLOCK_SKEW = Duration.ofMinutes(2);

    private SigningKeyRotationPolicy() {
    }

    static void validate(OtaSecurityProperties properties, Instant now) {
        boolean hasPreviousId = hasText(properties.getPreviousSigningKeyId());
        boolean hasPreviousRef = hasText(properties.getPreviousSigningSecretRef());
        boolean hasPreviousUntil = properties.getPreviousSigningKeyValidUntil() != null;
        int configured = (hasPreviousId ? 1 : 0) + (hasPreviousRef ? 1 : 0) + (hasPreviousUntil ? 1 : 0);
        if (configured == 0) {
            return;
        }
        if (configured != 3) {
            throw new IllegalStateException("Previous signing key id, reference and valid-until are all-or-none");
        }
        if (properties.getCurrentSigningKeyId().equals(properties.getPreviousSigningKeyId())) {
            throw new IllegalStateException("Previous and current signing key ids must differ");
        }
        Instant validUntil = properties.getPreviousSigningKeyValidUntil();
        Instant maximum = now.plus(properties.getAccessTtl()).plus(CLOCK_SKEW);
        if (!validUntil.isAfter(now) || validUntil.isAfter(maximum)) {
            throw new IllegalStateException("Previous signing key validation window is outside the safe bound");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
