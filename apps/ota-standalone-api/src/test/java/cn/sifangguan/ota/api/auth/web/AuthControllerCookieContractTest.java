package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.application.AuthenticationService;
import cn.sifangguan.ota.api.auth.application.IssuedSession;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.config.OtaSecurityProperties;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AuthControllerCookieContractTest {
    @Test
    void keepsRefreshCookieOnAuthPathAndCsrfCookieReadableFromRoot() {
        Instant now = Instant.parse("2026-07-23T00:00:00Z");
        AuthenticationService service = mock(AuthenticationService.class);
        when(service.login(anyString(), any(char[].class), anyString(), anyString())).thenReturn(new IssuedSession(
                "access", now.plusSeconds(600), "refresh", now.plusSeconds(3_600), "csrf",
                new AccountView(UUID.randomUUID(), "Admin", Set.of(OtaRole.PLATFORM_ADMIN))));
        OtaSecurityProperties properties = new OtaSecurityProperties();
        AuthController controller = new AuthController(
                service, properties, Clock.fixed(now, ZoneOffset.UTC));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("X-Correlation-ID", "abc-123");
        MockHttpServletResponse response = new MockHttpServletResponse();

        controller.login(new AuthController.LoginRequest("admin", "sixteen-character-password"), request, response);

        List<String> cookies = response.getHeaders("Set-Cookie");
        assertThat(cookies).anySatisfy(value -> assertThat(value)
                .contains("ota_refresh=refresh", "Path=/api/v1/auth", "HttpOnly", "Secure", "SameSite=Strict"));
        assertThat(cookies).anySatisfy(value -> assertThat(value)
                .contains("ota_csrf=csrf", "Path=/", "Secure", "SameSite=Strict")
                .doesNotContain("HttpOnly"));
        assertThat(response.getHeader("X-Correlation-ID")).isEqualTo("abc-123");
    }
}
