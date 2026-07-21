package cn.sifangguan.hotelaios.dashboard;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/dashboards")
public class DashboardController {
    private final DashboardService service;

    public DashboardController(DashboardService service) {
        this.service = service;
    }

    @GetMapping("/ceo")
    public Map<String, Object> ceo() {
        return service.ceoDashboard();
    }

    @GetMapping("/hotels/{hotelId}")
    public Map<String, Object> hotel(@PathVariable UUID hotelId) {
        return service.hotelDashboard(hotelId);
    }

    @GetMapping("/operations")
    public Map<String, Object> operations() {
        return service.operationsDashboard();
    }
}
