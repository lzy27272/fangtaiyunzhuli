package cn.sifangguan.hotelaios.performance;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kpi/inspections")
public class KpiInspectionController {
    private final KpiInspectionService service;

    public KpiInspectionController(KpiInspectionService service) {
        this.service = service;
    }

    @GetMapping("/schedules")
    public List<Map<String, Object>> schedules() {
        return service.schedules();
    }

    @PutMapping("/schedules/{timeSlot}")
    public Map<String, Object> updateSchedule(
            @PathVariable String timeSlot,
            @Valid @RequestBody KpiModels.UpdateInspectionSchedule request
    ) {
        return service.updateSchedule(timeSlot, request);
    }

    @GetMapping
    public List<Map<String, Object>> submissions(
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) UUID employeeId,
            @RequestParam(required = false) String timeSlot,
            @RequestParam(required = false) String result
    ) {
        return service.submissions(businessDate, orgUnitId, employeeId, timeSlot, result);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> submit(@Valid @RequestBody KpiModels.SubmitInspection request) {
        return service.submit(request);
    }

    @PostMapping("/{submissionId}/events")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> recordEvent(
            @PathVariable UUID submissionId,
            @Valid @RequestBody KpiModels.InspectionEvent request
    ) {
        return service.recordEvent(submissionId, request);
    }

    @PostMapping("/{submissionId}/verifications")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> verify(
            @PathVariable UUID submissionId,
            @Valid @RequestBody KpiModels.VerifyInspection request
    ) {
        return service.verify(submissionId, request);
    }
}
