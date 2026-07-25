package cn.sifangguan.hotelaios.dailyreporttemplates;

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
@RequestMapping("/api/v1/daily-report-templates")
public class DailyReportTemplateController {
    private final DailyReportTemplateService service;
    private final DailyReportDeliveryPolicyService deliveryPolicyService;

    public DailyReportTemplateController(
            DailyReportTemplateService service,
            DailyReportDeliveryPolicyService deliveryPolicyService
    ) {
        this.service = service;
        this.deliveryPolicyService = deliveryPolicyService;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) UUID positionId
    ) {
        return service.list(status, orgUnitId, positionId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.CreateTemplate request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{templateId}")
    public Map<String, Object> detail(@PathVariable UUID templateId) {
        return service.detail(templateId);
    }

    @PostMapping("/{templateId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createVersion(
            @PathVariable UUID templateId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.CreateVersion request
    ) {
        return service.createVersion(templateId, request, idempotencyKey);
    }

    @PutMapping("/{templateId}/versions/{versionId}")
    public Map<String, Object> updateVersion(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.UpdateVersion request
    ) {
        return service.updateVersion(templateId, versionId, request, idempotencyKey);
    }

    @PostMapping("/{templateId}/versions/{versionId}/actions/submit-review")
    public Map<String, Object> submitReview(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.VersionAction request
    ) {
        return service.submitReview(templateId, versionId, request, idempotencyKey);
    }

    @PostMapping("/{templateId}/versions/{versionId}/actions/publish")
    public Map<String, Object> publish(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.VersionAction request
    ) {
        return service.publish(templateId, versionId, request, idempotencyKey);
    }

    @PostMapping("/{templateId}/versions/{versionId}/actions/retire")
    public Map<String, Object> retire(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody DailyReportTemplateModels.VersionAction request
    ) {
        return service.retire(templateId, versionId, request, idempotencyKey);
    }

    @GetMapping("/resolve")
    public Map<String, Object> resolve(
            @RequestParam UUID orgUnitId,
            @RequestParam UUID positionAssignmentId,
            @RequestParam(required = false) LocalDate businessDate
    ) {
        return service.resolve(orgUnitId, positionAssignmentId, businessDate);
    }

    @GetMapping("/{templateId}/versions/{versionId}/delivery-policy")
    public DailyReportDeliveryPolicyModels.Policy deliveryPolicy(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId
    ) {
        return deliveryPolicyService.get(templateId, versionId);
    }

    @PutMapping("/{templateId}/versions/{versionId}/delivery-policy")
    public DailyReportDeliveryPolicyModels.Policy updateDeliveryPolicy(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @Valid @RequestBody DailyReportDeliveryPolicyModels.UpdatePolicy request
    ) {
        return deliveryPolicyService.update(templateId, versionId, request);
    }
}
