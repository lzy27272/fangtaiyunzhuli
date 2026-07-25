package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptView;

@RestController
@RequestMapping("/api/v1")
public class BrowserAuthorizationRehearsalController {
    private static final java.util.regex.Pattern SAFE_CORRELATION =
            java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{8,200}");

    private final BrowserAuthorizationRehearsalService service;

    public BrowserAuthorizationRehearsalController(
            BrowserAuthorizationRehearsalService service
    ) {
        this.service = service;
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts")
    public ResponseEntity<Envelope<AttemptView>> start(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @RequestHeader("Idempotency-Key")
            @jakarta.validation.constraints.Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody StartRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        AuthenticatedAccountPrincipal principal = principal(authentication);
        return noStore(new Envelope<>(service.start(
                principal.account(),
                principal.sessionId(),
                tenantId,
                hotelId,
                connectorId,
                body.expectedConfigVersion(),
                body.reasonCode(),
                idempotencyKey,
                correlationId(request, response))));
    }

    @GetMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts")
    public ResponseEntity<Envelope<AttemptView>> latest(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            Authentication authentication
    ) {
        return noStore(new Envelope<>(service.latest(
                account(authentication),
                tenantId,
                hotelId,
                connectorId)));
    }

    @GetMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts/{attemptId}")
    public ResponseEntity<Envelope<AttemptView>> inspect(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @PathVariable UUID attemptId,
            Authentication authentication
    ) {
        return noStore(new Envelope<>(service.inspect(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                attemptId)));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts/{attemptId}/confirm")
    public ResponseEntity<Envelope<AttemptView>> confirm(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @PathVariable UUID attemptId,
            @RequestHeader("Idempotency-Key")
            @jakarta.validation.constraints.Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody TransitionRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        AuthenticatedAccountPrincipal principal = principal(authentication);
        return noStore(new Envelope<>(service.confirm(
                principal.account(),
                principal.sessionId(),
                tenantId,
                hotelId,
                connectorId,
                attemptId,
                body.expectedRowVersion(),
                body.reasonCode(),
                idempotencyKey,
                correlationId(request, response))));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts/{attemptId}/cancel")
    public ResponseEntity<Envelope<AttemptView>> cancel(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @PathVariable UUID attemptId,
            @RequestHeader("Idempotency-Key")
            @jakarta.validation.constraints.Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody TransitionRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        AuthenticatedAccountPrincipal principal = principal(authentication);
        return noStore(new Envelope<>(service.cancel(
                principal.account(),
                principal.sessionId(),
                tenantId,
                hotelId,
                connectorId,
                attemptId,
                body.expectedRowVersion(),
                body.reasonCode(),
                idempotencyKey,
                correlationId(request, response))));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/browser-authorization-attempts/{attemptId}/reauthenticate")
    public ResponseEntity<Envelope<AttemptView>> reauthenticate(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @PathVariable UUID attemptId,
            @RequestHeader("Idempotency-Key")
            @jakarta.validation.constraints.Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody TransitionRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        AuthenticatedAccountPrincipal principal = principal(authentication);
        return noStore(new Envelope<>(service.reauthenticate(
                principal.account(),
                principal.sessionId(),
                tenantId,
                hotelId,
                connectorId,
                attemptId,
                body.expectedRowVersion(),
                body.reasonCode(),
                idempotencyKey,
                correlationId(request, response))));
    }

    private static AccountView account(Authentication authentication) {
        return principal(authentication).account();
    }

    private static AuthenticatedAccountPrincipal principal(
            Authentication authentication
    ) {
        if (authentication == null
                || !(authentication.getPrincipal()
                instanceof AuthenticatedAccountPrincipal principal)) {
            throw new SecurityException("Authenticated account is required");
        }
        if (principal.sessionId() == null) {
            throw new SecurityException(
                    "Authenticated session context is required");
        }
        return principal;
    }

    private static String correlationId(
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String candidate = request.getHeader("X-Correlation-ID");
        String value = candidate != null
                && SAFE_CORRELATION.matcher(candidate).matches()
                ? candidate
                : UUID.randomUUID().toString();
        response.setHeader("X-Correlation-ID", value);
        return value;
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    public record Envelope<T>(T data) {
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record StartRequest(
            @Min(0) long expectedConfigVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String reasonCode
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException(
                    "Unknown offline rehearsal start field: " + name);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record TransitionRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String reasonCode
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException(
                    "Unknown offline rehearsal transition field: " + name);
        }
    }
}
