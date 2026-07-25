package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.Envelope;

@RestController
@RequestMapping("/api/v1")
public class Sprint2ConnectorAdmissionController {
    private final ConnectorAdmissionReadinessService service;

    public Sprint2ConnectorAdmissionController(
            ConnectorAdmissionReadinessService service
    ) {
        this.service = service;
    }

    @GetMapping(
            "/ota/tenants/{tenantId}/hotels/{hotelId}/connector-contract-admissions")
    public ResponseEntity<Envelope<List<ConnectorContractAdmissionView>>>
            connectorContractAdmissions(
                    @PathVariable UUID tenantId,
                    @PathVariable UUID hotelId,
                    Authentication authentication
            ) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(new Envelope<>(service.listReadiness(
                        account(authentication),
                        tenantId,
                        hotelId)));
    }

    private static AccountView account(Authentication authentication) {
        if (authentication == null
                || !(authentication.getPrincipal()
                instanceof AuthenticatedAccountPrincipal principal)) {
            throw new SecurityException("Authenticated account is required");
        }
        return principal.account();
    }
}
