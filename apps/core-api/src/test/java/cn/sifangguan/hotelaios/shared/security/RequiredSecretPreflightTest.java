package cn.sifangguan.hotelaios.shared.security;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import org.junit.jupiter.api.Test;

class RequiredSecretPreflightTest {

    @Test
    void acceptsNonBlankExternalSecrets() {
        assertThatCode(() -> RequiredSecretPreflight.validate(Map.of(
                "DB_PASSWORD", "runtime-sentinel",
                "DB_MIGRATION_PASSWORD", "migration-sentinel")))
                .doesNotThrowAnyException();
    }

    @Test
    void rejectsMissingOrBlankSecretsWithoutIncludingProvidedValues() {
        assertThatThrownBy(() -> RequiredSecretPreflight.validate(Map.of(
                "DB_PASSWORD", "provided-value-must-not-be-logged",
                "DB_MIGRATION_PASSWORD", "   ")))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DB_MIGRATION_PASSWORD")
                .hasMessageNotContaining("provided-value-must-not-be-logged");
    }

    @Test
    void reportsEveryMissingSecretName() {
        assertThatThrownBy(() -> RequiredSecretPreflight.validate(Map.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DB_PASSWORD")
                .hasMessageContaining("DB_MIGRATION_PASSWORD");
    }
}
