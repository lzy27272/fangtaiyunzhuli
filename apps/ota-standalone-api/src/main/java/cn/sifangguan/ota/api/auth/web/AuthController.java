package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.application.AuthenticationService;
import cn.sifangguan.ota.api.auth.application.IssuedSession;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.config.OtaSecurityProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Clock;
import java.time.Duration;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private static final Pattern CORRELATION_ID = Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    private final AuthenticationService authenticationService;
    private final OtaSecurityProperties properties;
    private final CookieRequestGuard requestGuard;
    private final Clock clock;

    public AuthController(
            AuthenticationService authenticationService,
            OtaSecurityProperties properties,
            Clock clock
    ) {
        this.authenticationService = authenticationService;
        this.properties = properties;
        this.requestGuard = new CookieRequestGuard(properties);
        this.clock = clock;
    }

    @PostMapping("/login")
    public ResponseEntity<AccessResponse> login(
            @Valid @RequestBody LoginRequest body,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        requestGuard.verifyOriginWhenPresent(request);
        char[] password = body.password().toCharArray();
        IssuedSession issued = authenticationService.login(
                body.username(), password, request.getRemoteAddr(), correlationId(request, response));
        writeSessionCookies(response, issued);
        return noStore(AccessResponse.from(issued, clock));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AccessResponse> refresh(
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        requestGuard.verifyOriginWhenPresent(request);
        requestGuard.verifyCsrf(request);
        IssuedSession issued = authenticationService.refresh(
                requestGuard.requireRefreshToken(request), correlationId(request, response));
        writeSessionCookies(response, issued);
        return noStore(AccessResponse.from(issued, clock));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(HttpServletRequest request, HttpServletResponse response) {
        requestGuard.verifyOriginWhenPresent(request);
        requestGuard.verifyCsrf(request);
        authenticationService.logout(
                requestGuard.requireRefreshToken(request), correlationId(request, response));
        clearSessionCookies(response);
        return ResponseEntity.noContent()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }

    @GetMapping("/me")
    public AccountResponse me(Authentication authentication) {
        AuthenticatedAccountPrincipal principal = (AuthenticatedAccountPrincipal) authentication.getPrincipal();
        return AccountResponse.from(principal.account());
    }

    private void writeSessionCookies(HttpServletResponse response, IssuedSession issued) {
        Duration refreshMaxAge = Duration.between(clock.instant(), issued.refreshExpiresAt());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                properties.getCookie().getRefreshName(), issued.refreshToken(), true,
                properties.getCookie().getRefreshPath(), refreshMaxAge).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                properties.getCookie().getCsrfName(), issued.csrfToken(), false,
                properties.getCookie().getCsrfPath(), refreshMaxAge).toString());
    }

    private void clearSessionCookies(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                properties.getCookie().getRefreshName(), "", true,
                properties.getCookie().getRefreshPath(), Duration.ZERO).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                properties.getCookie().getCsrfName(), "", false,
                properties.getCookie().getCsrfPath(), Duration.ZERO).toString());
    }

    private ResponseCookie cookie(String name, String value, boolean httpOnly, String path, Duration maxAge) {
        return ResponseCookie.from(name, value)
                .httpOnly(httpOnly)
                .secure(properties.getCookie().isSecure())
                .sameSite(properties.getCookie().getSameSite())
                .path(path)
                .maxAge(maxAge.isNegative() ? Duration.ZERO : maxAge)
                .build();
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header("Pragma", "no-cache")
                .body(body);
    }

    private static String correlationId(HttpServletRequest request, HttpServletResponse response) {
        String candidate = request.getHeader("X-Correlation-ID");
        String value = candidate != null && CORRELATION_ID.matcher(candidate).matches()
                ? candidate : UUID.randomUUID().toString();
        response.setHeader("X-Correlation-ID", value);
        return value;
    }

    public record LoginRequest(
            @NotBlank @Size(max = 64) String username,
            @NotBlank @Size(max = 256) String password
    ) {
    }

    public record AccessResponse(
            String accessToken,
            long expiresInSeconds,
            AccountResponse account
    ) {
        static AccessResponse from(IssuedSession session, Clock clock) {
            long expiresIn = Math.max(1, Duration.between(clock.instant(), session.accessExpiresAt()).toSeconds());
            return new AccessResponse(session.accessToken(), expiresIn, AccountResponse.from(session.account()));
        }
    }

    public record AccountResponse(UUID id, String displayName, Set<OtaRole> roles) {
        public AccountResponse {
            roles = Set.copyOf(roles);
        }

        static AccountResponse from(AccountView account) {
            return new AccountResponse(account.id(), account.displayName(), account.roles());
        }
    }
}
