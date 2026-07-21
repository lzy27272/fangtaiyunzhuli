package cn.sifangguan.hotelaios.notifications;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/notifications")
public class NotificationController {
    private final NotificationService service;

    public NotificationController(NotificationService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(defaultValue = "false") boolean unreadOnly) {
        return service.list(unreadOnly);
    }

    @PostMapping("/{notificationId}/read")
    public Map<String, Object> markRead(
            @PathVariable UUID notificationId,
            @Valid @RequestBody NotificationModels.MarkRead request
    ) {
        return service.markRead(notificationId, request.expectedVersion());
    }
}
