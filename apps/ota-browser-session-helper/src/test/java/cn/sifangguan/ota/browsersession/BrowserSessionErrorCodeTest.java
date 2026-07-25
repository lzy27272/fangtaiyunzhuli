package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BrowserSessionErrorCodeTest {
    @Test
    void exposesOnlyStableSanitizedCodes() {
        assertEquals(
                List.of(
                        "BSH_INVALID_SESSION_SCOPE",
                        "BSH_SESSION_SCOPE_MISMATCH",
                        "BSH_INVALID_STATE_TRANSITION",
                        "BSH_NON_MONOTONIC_TRANSITION_TIME",
                        "BSH_INTERACTIVE_LOGIN_REQUIRED",
                        "BSH_SESSION_EXPIRING",
                        "BSH_REAUTH_REQUIRED",
                        "BSH_SESSION_REVOKED",
                        "BSH_INVALID_TARGET",
                        "BSH_INVALID_REQUEST_CONTRACT",
                        "BSH_TARGET_NOT_ALLOWLISTED",
                        "BSH_INVALID_RESOLVED_ADDRESS",
                        "BSH_RESOLVED_ADDRESS_REQUIRED",
                        "BSH_NON_PUBLIC_ADDRESS_FORBIDDEN",
                        "BSH_UNKNOWN_CONFIGURATION_KEY"),
                Stream.of(BrowserSessionErrorCode.values())
                        .map(BrowserSessionErrorCode::code)
                        .toList());
        assertTrue(Stream.of(BrowserSessionErrorCode.values())
                .map(BrowserSessionErrorCode::code)
                .allMatch(code -> code.matches("[A-Z0-9_]+")));
    }
}
