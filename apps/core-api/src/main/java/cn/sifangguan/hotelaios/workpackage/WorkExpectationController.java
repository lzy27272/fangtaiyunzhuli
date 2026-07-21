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
public class WorkExpectationController {
    private final WorkPackageService service;
    private final WorkExpectationSlaService slaService;

    public WorkExpectationController(WorkPackageService service, WorkExpectationSlaService slaService) {
        this.service = service;
        this.slaService = slaService;
    }

    @GetMapping("/api/v1/work-expectations")
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID positionAssignmentId,
            @RequestParam(required = false) UUID targetOrgUnitId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate businessDate
    ) {
        return service.expectations(status, positionAssignmentId, targetOrgUnitId, businessDate, false);
    }

    @GetMapping("/api/v1/my/work-expectations")
    public List<Map<String, Object>> mine(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate businessDate
    ) {
        return service.expectations(status, null, null, businessDate, true);
    }

    @GetMapping("/api/v1/team/work-expectations")
    public List<Map<String, Object>> team(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate businessDate
    ) {
        return service.teamExpectations(status, businessDate);
    }

    @GetMapping("/api/v1/work-expectations/{expectationId}")
    public Map<String, Object> detail(@PathVariable UUID expectationId) {
        return service.expectationDetail(expectationId);
    }

    @PostMapping("/api/v1/work-expectations/actions/generate")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> generate(@Valid @RequestBody WorkPackageModels.GenerateExpectations request) {
        return service.generateExpectations(request);
    }

    @PostMapping("/api/v1/work-expectations/sla/process")
    public WorkPackageModels.SlaProcessResult processSla(
            @RequestParam(defaultValue = "100") int limit
    ) {
        return slaService.processCurrentTenant(limit);
    }

    @PostMapping("/api/v1/work-expectations/{expectationId}/waive")
    public Map<String, Object> waive(
            @PathVariable UUID expectationId,
            @Valid @RequestBody WorkPackageModels.ExpectationAction request
    ) {
        return service.waiveExpectation(expectationId, request);
    }

    @PostMapping("/api/v1/work-expectations/{expectationId}/cancel")
    public Map<String, Object> cancel(
            @PathVariable UUID expectationId,
            @Valid @RequestBody WorkPackageModels.ExpectationAction request
    ) {
        return service.cancelExpectation(expectationId, request);
    }
}
