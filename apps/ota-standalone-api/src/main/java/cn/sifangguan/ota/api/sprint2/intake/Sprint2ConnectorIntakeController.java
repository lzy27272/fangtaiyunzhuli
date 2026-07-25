package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
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

import java.util.List;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.BlockedAction;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.Envelope;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.IntakeTemplate;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

@RestController
@RequestMapping("/api/v1")
public class Sprint2ConnectorIntakeController {
    private static final java.util.regex.Pattern SAFE_CORRELATION =
            java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{8,200}");

    private final ConnectorIntakeService service;

    public Sprint2ConnectorIntakeController(ConnectorIntakeService service) {
        this.service = service;
    }

    @GetMapping("/ota/connector-onboarding/templates")
    public ResponseEntity<Envelope<List<IntakeTemplate>>> templates(
            Authentication authentication
    ) {
        return noStore(new Envelope<>(service.templates(account(authentication))));
    }

    @GetMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding")
    public ResponseEntity<Envelope<List<ConnectorDraftView>>> connectorOnboarding(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            Authentication authentication
    ) {
        return noStore(new Envelope<>(service.listDrafts(
                account(authentication),
                tenantId,
                hotelId)));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}")
    public ResponseEntity<Envelope<CommandReceipt>> saveConnectorOnboarding(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @RequestHeader("Idempotency-Key")
            @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody ConnectorOnboardingRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        List<SecretBindingInput> bindings = body.secretBindings().stream()
                .map(binding -> new SecretBindingInput(
                        binding.purpose(),
                        binding.providerCode(),
                        binding.secretReference(),
                        binding.secretVersion()))
                .toList();
        CommandReceipt receipt = service.saveDraft(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                body.expectedRowVersion(),
                body.reasonCode(),
                idempotencyKey,
                body.templateCode(),
                SourceCode.valueOf(body.sourceCode()),
                body.vendorCode(),
                body.vendorName(),
                body.productName(),
                body.productVersion(),
                body.connectionMethod(),
                body.externalHotelCode(),
                body.accountAlias(),
                body.networkRouteCode(),
                body.pollIntervalMinutes(),
                bindings,
                correlationId(request, response));
        return noStore(new Envelope<>(receipt));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/test")
    public void rejectConnectionTest(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        service.rejectExternalAction(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                BlockedAction.TEST_CONNECTION,
                correlationId(request, response));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/activate")
    public void rejectActivation(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        service.rejectExternalAction(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                BlockedAction.ACTIVATE,
                correlationId(request, response));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/run")
    public void rejectRuntime(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        service.rejectExternalAction(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                BlockedAction.RUN,
                correlationId(request, response));
    }

    private static AccountView account(Authentication authentication) {
        if (authentication == null
                || !(authentication.getPrincipal()
                instanceof AuthenticatedAccountPrincipal principal)) {
            throw new SecurityException("Authenticated account is required");
        }
        return principal.account();
    }

    private static String correlationId(
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String candidate = request.getHeader("X-Correlation-ID");
        String value = candidate != null && SAFE_CORRELATION.matcher(candidate).matches()
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

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record ConnectorOnboardingRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String reasonCode,
            @NotBlank @Pattern(regexp = "(PMS|CTRIP|MEITUAN)_INTAKE")
            String templateCode,
            @NotBlank @Pattern(regexp = "PMS|CTRIP|MEITUAN")
            String sourceCode,
            @NotBlank @Size(max = 64) String vendorCode,
            @NotBlank @Size(max = 160) String vendorName,
            @NotBlank @Size(max = 160) String productName,
            @Size(max = 80) String productVersion,
            @NotBlank @Size(max = 64) String connectionMethod,
            @NotBlank @Size(max = 160) String externalHotelCode,
            @Size(max = 160) String accountAlias,
            @NotBlank @Size(max = 96) String networkRouteCode,
            @Min(5) @Max(30) int pollIntervalMinutes,
            @NotNull @Size(max = 4)
            List<@Valid SecretBindingRequest> secretBindings
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException(
                    "Unknown connector intake field: " + name);
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record SecretBindingRequest(
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String purpose,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{1,47}")
            String providerCode,
            @NotBlank @Size(max = 512)
            @Pattern(
                    regexp = "(kms|vault|secretstore|oskeyring|envref)://[A-Za-z0-9._:/@+-]{3,500}")
            String secretReference,
            @NotBlank @Size(max = 96) String secretVersion
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException(
                    "Unknown secret binding field: " + name);
        }
    }
}
