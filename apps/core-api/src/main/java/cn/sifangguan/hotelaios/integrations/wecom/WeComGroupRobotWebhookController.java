package cn.sifangguan.hotelaios.integrations.wecom;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Store-level configuration for the one-way WeCom group robot transition channel.
 * This endpoint configures a destination only; it does not enable any delivery worker.
 */
@RestController
@RequestMapping("/api/v1/integrations/wecom/group-webhooks")
public class WeComGroupRobotWebhookController {
    private final WeComGroupRobotWebhookService service;

    public WeComGroupRobotWebhookController(WeComGroupRobotWebhookService service) {
        this.service = service;
    }

    @GetMapping
    public List<WeComGroupRobotWebhookModels.StoreWebhookStatus> list() {
        return service.listStoreWebhooks();
    }

    @PutMapping("/{hotelOrgUnitId}")
    public WeComGroupRobotWebhookModels.SaveWebhookResult save(
            @PathVariable UUID hotelOrgUnitId,
            @Valid @RequestBody WeComGroupRobotWebhookModels.SaveWebhook request
    ) {
        return service.saveStoreWebhook(hotelOrgUnitId, request);
    }
}
