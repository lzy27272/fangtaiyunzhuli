package cn.sifangguan.ota.api.config;

import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SigningKeyRotationPolicyTest {
    private static final Instant NOW = Instant.parse("2026-07-23T00:00:00Z");

    @Test
    void acceptsNoPreviousKeyOrACompleteShortOverlap() {
        assertThatCode(() -> SigningKeyRotationPolicy.validate(new OtaSecurityProperties(), NOW))
                .doesNotThrowAnyException();
        OtaSecurityProperties properties = completePrevious();
        assertThatCode(() -> SigningKeyRotationPolicy.validate(properties, NOW))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsPartialSameKidExpiredOrOverlongPreviousKeyConfiguration() {
        OtaSecurityProperties partial = new OtaSecurityProperties();
        partial.setPreviousSigningKeyId("old");
        assertThatThrownBy(() -> SigningKeyRotationPolicy.validate(partial, NOW))
                .isInstanceOf(IllegalStateException.class);

        OtaSecurityProperties sameKid = completePrevious();
        sameKid.setPreviousSigningKeyId(sameKid.getCurrentSigningKeyId());
        assertThatThrownBy(() -> SigningKeyRotationPolicy.validate(sameKid, NOW))
                .isInstanceOf(IllegalStateException.class);

        OtaSecurityProperties expired = completePrevious();
        expired.setPreviousSigningKeyValidUntil(NOW);
        assertThatThrownBy(() -> SigningKeyRotationPolicy.validate(expired, NOW))
                .isInstanceOf(IllegalStateException.class);

        OtaSecurityProperties overlong = completePrevious();
        overlong.setPreviousSigningKeyValidUntil(NOW.plusSeconds(12 * 60 + 1));
        assertThatThrownBy(() -> SigningKeyRotationPolicy.validate(overlong, NOW))
                .isInstanceOf(IllegalStateException.class);
    }

    private static OtaSecurityProperties completePrevious() {
        OtaSecurityProperties properties = new OtaSecurityProperties();
        properties.setPreviousSigningKeyId("old-key");
        properties.setPreviousSigningSecretRef("env:OTA_OLD_KEY");
        properties.setPreviousSigningKeyValidUntil(NOW.plusSeconds(11 * 60));
        return properties;
    }
}
