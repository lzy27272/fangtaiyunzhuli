package cn.sifangguan.hotelaios.rules;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.events.OutboxAutomationService;
import cn.sifangguan.hotelaios.shared.events.OutboxProjector;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/management-events")
public class OutboxRecoveryController {
    private final OutboxAutomationService automationService;
    private final AccessPolicy accessPolicy;

    public OutboxRecoveryController(OutboxAutomationService automationService, AccessPolicy accessPolicy) {
        this.automationService = automationService;
        this.accessPolicy = accessPolicy;
    }

    @PostMapping("/actions/project-outbox")
    public List<OutboxProjector.ProjectionResult> recover(
            @RequestParam(defaultValue = "20") int limit
    ) {
        accessPolicy.requirePermission("rule.manage");
        TenantPrincipal principal = accessPolicy.principal();
        return automationService.recover(principal.tenantId(), principal.correlationId(), limit);
    }
}
