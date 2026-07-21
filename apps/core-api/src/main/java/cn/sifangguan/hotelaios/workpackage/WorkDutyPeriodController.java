package cn.sifangguan.hotelaios.workpackage;

import jakarta.validation.Valid;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/work-duty-periods")
public class WorkDutyPeriodController {
    private final WorkPackageService service;

    public WorkDutyPeriodController(WorkPackageService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) UUID positionAssignmentId,
            @RequestParam(required = false) UUID targetOrgUnitId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate businessDate
    ) {
        return service.dutyPeriods(positionAssignmentId, targetOrgUnitId, businessDate);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@Valid @RequestBody WorkPackageModels.CreateDutyPeriod request) {
        return service.createDutyPeriod(request);
    }
}
