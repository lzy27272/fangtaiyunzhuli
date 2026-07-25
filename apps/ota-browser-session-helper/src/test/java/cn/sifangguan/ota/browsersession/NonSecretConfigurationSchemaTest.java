package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class NonSecretConfigurationSchemaTest {
    private final NonSecretConfigurationSchema schema =
            NonSecretConfigurationSchema.browserSessionHelperSchema();

    @Test
    void acceptsOnlyServerOwnedTypedNonSecretFieldNames() {
        assertEquals(
                Set.of(
                        "approvedTargetSetVersion",
                        "hotelExternalId",
                        "pollIntervalSeconds",
                        "providerCode"),
                schema.allowedKeys());
        assertDoesNotThrow(() -> schema.assertDeclaredKeys(schema.allowedKeys()));
    }

    @Test
    void refusesEveryUnknownKeyWithoutReceivingConfigurationValues() {
        for (var key : Set.of(
                "cookie",
                "hotelpmsToken",
                "customEndpoint",
                "extraField",
                "secretReference")) {
            var exception = assertThrows(
                    BrowserSessionPolicyException.class,
                    () -> schema.assertDeclaredKeys(Set.of(key)));
            assertEquals(
                    BrowserSessionErrorCode.UNKNOWN_CONFIGURATION_KEY,
                    exception.errorCode());
        }
    }
}
