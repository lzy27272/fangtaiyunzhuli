package cn.sifangguan.hotelaios.dailyreports;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/daily-reports")
public class DailyReportController {
    private final DailyReportService service;

    public DailyReportController(DailyReportService service) {
        this.service = service;
    }

    @GetMapping("/my")
    public List<Map<String, Object>> myReports(
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID positionAssignmentId
    ) {
        return service.myReports(businessDate, status, positionAssignmentId);
    }

    @GetMapping("/team")
    public List<Map<String, Object>> teamReports(
            @RequestParam UUID orgUnitId,
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false) String status
    ) {
        return service.teamReports(orgUnitId, businessDate, status);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.CreateReport request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{reportId}")
    public Map<String, Object> detail(@PathVariable UUID reportId) {
        return service.detail(reportId);
    }

    @PutMapping("/{reportId}/draft")
    public Map<String, Object> saveDraft(
            @PathVariable UUID reportId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.SaveDraft request
    ) {
        return service.saveDraft(reportId, request, idempotencyKey);
    }

    @PostMapping("/{reportId}/actions/submit")
    public Map<String, Object> submit(
            @PathVariable UUID reportId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.SubmitReport request
    ) {
        return service.submit(reportId, request, idempotencyKey);
    }

    @PostMapping("/{reportId}/corrections")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createCorrection(
            @PathVariable UUID reportId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.CreateCorrection request
    ) {
        return service.createCorrection(reportId, request, idempotencyKey);
    }

    @PostMapping("/{reportId}/reviews")
    public Map<String, Object> review(
            @PathVariable UUID reportId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.Review request
    ) {
        return service.review(reportId, request, idempotencyKey);
    }

    @PostMapping("/{reportId}/revisions/{revisionId}/sources")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addSource(
            @PathVariable UUID reportId,
            @PathVariable UUID revisionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.AddSource request
    ) {
        return service.addSource(reportId, revisionId, request, idempotencyKey);
    }

    @PostMapping("/{reportId}/revisions/{revisionId}/evidence")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addEvidence(
            @PathVariable UUID reportId,
            @PathVariable UUID revisionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportModels.AddEvidence request
    ) {
        return service.addEvidence(reportId, revisionId, request, idempotencyKey);
    }
}
