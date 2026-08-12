package cn.sifangguan.ota.api.finalstage;

import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static cn.sifangguan.ota.api.finalstage.FinalStageModels.CapabilityStatus;

@RestController
@RequestMapping("/api/v1/ota-assistant/final-stage")
public class FinalStageController {
    private final FinalStagePolicyEngine policy;

    public FinalStageController(FinalStagePolicyEngine policy) {
        this.policy = policy;
    }

    @GetMapping("/capabilities")
    public ResponseEntity<CapabilityStatus> capabilities(Authentication authentication) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthenticatedAccountPrincipal)) {
            throw new SecurityException("Authenticated account is required");
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(policy.capabilityStatus());
    }
}
