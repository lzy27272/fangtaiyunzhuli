package cn.sifangguan.ota.api.sprint2.migration;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
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

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Envelope;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;

@RestController
@RequestMapping("/api/v1")
public class CredentialMigrationController {
    private static final java.util.regex.Pattern SAFE_CORRELATION =
            java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{8,200}");

    private final CredentialMigrationService service;

    public CredentialMigrationController(CredentialMigrationService service) {
        this.service = service;
    }

    @GetMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals")
    public ResponseEntity<Envelope<List<RehearsalView>>> list(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            Authentication authentication
    ) {
        return noStore(new Envelope<>(service.list(
                account(authentication), tenantId, hotelId, connectorId)));
    }

    @PostMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals")
    public ResponseEntity<Envelope<Receipt>> prepare(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @RequestHeader("Idempotency-Key")
            @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+")
            String idempotencyKey,
            @Valid @RequestBody PrepareRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        Receipt receipt = service.prepare(
                account(authentication),
                tenantId,
                hotelId,
                connectorId,
                body.connectorVersionId(),
                body.expectedBindingRowVersion(),
                body.secretPurpose(),
                body.sourceSystemCode(),
                body.sourceLocatorHash(),
                body.targetProviderCode(),
                body.targetSecretVersion(),
                body.targetSecretFingerprint(),
                body.reasonCode(),
                idempotencyKey,
                correlationId(request, response));
        return noStore(new Envelope<>(receipt));
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

    @JsonIgnoreProperties(ignoreUnknown = false)
    public record PrepareRequest(
            @NotNull UUID connectorVersionId,
            @Min(0) long expectedBindingRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String secretPurpose,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String sourceSystemCode,
            @NotBlank @Pattern(regexp = "[A-Fa-f0-9]{64}")
            String sourceLocatorHash,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{1,47}")
            String targetProviderCode,
            @NotBlank @Size(max = 96)
            String targetSecretVersion,
            @NotBlank @Pattern(regexp = "sha256:[A-Fa-f0-9]{64}")
            String targetSecretFingerprint,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}")
            String reasonCode
    ) {
        @JsonAnySetter
        public void rejectUnknownField(String name, Object value) {
            throw new IllegalArgumentException(
                    "Unknown credential migration metadata field: " + name);
        }
    }
}
