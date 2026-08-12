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
@RequestMapping("/api/v1/kpi")
public class KpiCatalogController {
    private final KpiCatalogService service;

    public KpiCatalogController(KpiCatalogService service) {
        this.service = service;
    }

    @GetMapping("/metrics")
    public List<Map<String, Object>> metrics() {
        return service.metrics();
    }

    @PostMapping("/metrics/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createMetric(@Valid @RequestBody KpiModels.CreateMetricVersion request) {
        return service.createMetricVersion(request);
    }

    @PostMapping("/metrics/versions/{versionId}/actions/publish")
    public Map<String, Object> publishMetric(
            @PathVariable UUID versionId,
            @Valid @RequestBody KpiModels.PublishMetricVersion request
    ) {
        return service.publishMetricVersion(versionId, request);
    }

    @GetMapping("/metric-facts")
    public List<Map<String, Object>> facts(
            @RequestParam(required = false) UUID metricVersionId,
            @RequestParam(required = false) LocalDate from,
            @RequestParam(required = false) LocalDate to,
            @RequestParam(required = false) UUID orgUnitId
    ) {
        return service.facts(metricVersionId, from, to, orgUnitId);
    }

    @PostMapping("/metric-facts")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> recordFact(@Valid @RequestBody KpiModels.RecordMetricFact request) {
        return service.recordFact(request);
    }

    @GetMapping("/policies")
    public List<Map<String, Object>> policies() {
        return service.policies();
    }

    @PostMapping("/policies")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createPolicy(@Valid @RequestBody KpiModels.CreatePolicy request) {
        return service.createPolicy(request);
    }

    @PostMapping("/policies/{policyId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createPolicyVersion(
            @PathVariable UUID policyId,
            @Valid @RequestBody KpiModels.CreatePolicyVersion request
    ) {
        return service.createPolicyVersion(policyId, request);
    }

    @PostMapping("/policies/versions/{versionId}/actions/publish")
    public Map<String, Object> publishPolicyVersion(@PathVariable UUID versionId) {
        return service.publishPolicyVersion(versionId);
    }

    @GetMapping("/templates")
    public List<Map<String, Object>> templates(
            @RequestParam(required = false) UUID positionId,
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) String status
    ) {
        return service.templates(positionId, orgUnitId, status);
    }

    @PostMapping("/templates")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createTemplate(@Valid @RequestBody KpiModels.CreateTemplate request) {
        return service.createTemplate(request);
    }

    @GetMapping("/templates/{templateId}")
    public Map<String, Object> template(@PathVariable UUID templateId) {
        return service.templateDetail(templateId);
    }

    @GetMapping("/template-versions/{versionId}")
    public Map<String, Object> templateVersion(@PathVariable UUID versionId) {
        return service.templateVersion(versionId);
    }

    @PutMapping("/template-versions/{versionId}")
    public Map<String, Object> updateTemplateVersion(
            @PathVariable UUID versionId,
            @Valid @RequestBody KpiModels.UpdateTemplateVersion request
    ) {
        return service.updateTemplateVersion(versionId, request);
    }

    @PostMapping("/templates/{templateId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createTemplateVersion(
            @PathVariable UUID templateId,
            @Valid @RequestBody KpiModels.CreateTemplateVersion request
    ) {
        return service.createTemplateVersion(templateId, request);
    }

    @PostMapping("/template-versions/{versionId}/reviews")
    public Map<String, Object> reviewTemplate(
            @PathVariable UUID versionId,
            @Valid @RequestBody KpiModels.TemplateReview request
    ) {
        return service.reviewTemplate(versionId, request);
    }

    @PostMapping("/template-versions/{versionId}/actions/publish")
    public Map<String, Object> publishTemplate(
            @PathVariable UUID versionId,
            @Valid @RequestBody KpiModels.TemplatePublish request
    ) {
        return service.publishTemplate(versionId, request);
    }
}
