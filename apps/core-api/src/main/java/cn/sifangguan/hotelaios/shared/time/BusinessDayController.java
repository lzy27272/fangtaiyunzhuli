package cn.sifangguan.hotelaios.shared.time;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/business-days")
public class BusinessDayController {
    private final BusinessDayService service;

    public BusinessDayController(BusinessDayService service) {
        this.service = service;
    }

    @GetMapping("/current")
    public BusinessDayService.BusinessDayContext current(@RequestParam UUID orgUnitId) {
        return service.resolveCurrent(orgUnitId);
    }
}
