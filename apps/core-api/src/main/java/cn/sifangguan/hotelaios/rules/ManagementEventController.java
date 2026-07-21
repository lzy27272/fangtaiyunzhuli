package cn.sifangguan.hotelaios.rules;

import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/management-events")
public class ManagementEventController {
    private final RuleService service;

    public ManagementEventController(RuleService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status) {
        return service.events(status);
    }

    @PostMapping("/{eventId}/consume")
    public Map<String, Object> consume(@PathVariable UUID eventId) {
        return service.consume(eventId);
    }
}
