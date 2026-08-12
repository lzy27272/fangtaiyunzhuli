package cn.sifangguan.hotelaios.investment;

import jakarta.validation.Valid;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/investments")
public class InvestmentController {
    private final InvestmentService service;

    public InvestmentController(InvestmentService service) {
        this.service = service;
    }

    @GetMapping("/projects")
    public List<InvestmentModels.InvestmentProjectSummary> projects(
            @RequestParam(defaultValue = "false") boolean includeArchived
    ) {
        return service.projects(includeArchived);
    }

    @PostMapping("/projects")
    @ResponseStatus(HttpStatus.CREATED)
    public InvestmentModels.InvestmentProjectDetail createProject(
            @Valid @RequestBody InvestmentModels.CreateProjectRequest request
    ) {
        return service.createProject(request);
    }

    @GetMapping("/projects/{projectId}")
    public InvestmentModels.InvestmentProjectDetail project(@PathVariable UUID projectId) {
        return service.project(projectId);
    }

    @PutMapping("/versions/{versionId}")
    public InvestmentModels.InvestmentVersionView updateDraft(
            @PathVariable UUID versionId,
            @Valid @RequestBody InvestmentModels.UpdateDraftRequest request
    ) {
        return service.updateDraft(versionId, request);
    }

    @PostMapping("/versions/{versionId}/actions/confirm")
    public InvestmentModels.InvestmentVersionView confirm(
            @PathVariable UUID versionId,
            @Valid @RequestBody InvestmentModels.VersionCommand request
    ) {
        return service.confirm(versionId, request.expectedVersion());
    }

    @PostMapping("/versions/{versionId}/actions/copy")
    @ResponseStatus(HttpStatus.CREATED)
    public InvestmentModels.InvestmentVersionView copy(@PathVariable UUID versionId) {
        return service.copyVersion(versionId);
    }

    @PostMapping("/projects/{projectId}/actions/archive")
    public InvestmentModels.InvestmentProjectDetail archive(
            @PathVariable UUID projectId,
            @Valid @RequestBody InvestmentModels.VersionCommand request
    ) {
        return service.setArchived(projectId, true, request.expectedVersion());
    }

    @PostMapping("/projects/{projectId}/actions/restore")
    public InvestmentModels.InvestmentProjectDetail restore(
            @PathVariable UUID projectId,
            @Valid @RequestBody InvestmentModels.VersionCommand request
    ) {
        return service.setArchived(projectId, false, request.expectedVersion());
    }

    @GetMapping("/projects/{projectId}/audit")
    public List<InvestmentModels.AuditEntry> audit(@PathVariable UUID projectId) {
        return service.auditEntries(projectId);
    }

    @GetMapping("/cost-parameters")
    public List<InvestmentModels.CostParameterView> costParameters() {
        return service.costParameterVersions();
    }

    @PostMapping("/cost-parameters")
    @ResponseStatus(HttpStatus.CREATED)
    public InvestmentModels.CostParameterView createCostParameters(
            @Valid @RequestBody InvestmentModels.CreateCostParameterRequest request
    ) {
        return service.createCostParameters(request);
    }

    @PutMapping("/cost-parameters/{id}")
    public InvestmentModels.CostParameterView updateCostParameters(
            @PathVariable UUID id,
            @Valid @RequestBody InvestmentModels.UpdateCostParameterRequest request
    ) {
        return service.updateCostParameters(id, request);
    }

    @PostMapping("/cost-parameters/{id}/actions/activate")
    public InvestmentModels.CostParameterView activateCostParameters(
            @PathVariable UUID id,
            @Valid @RequestBody InvestmentModels.VersionCommand request
    ) {
        return service.activateCostParameters(id, request.expectedVersion());
    }

    @GetMapping("/versions/{versionId}/exports/excel")
    public ResponseEntity<ByteArrayResource> exportExcel(@PathVariable UUID versionId) {
        return download(service.exportXlsx(versionId));
    }

    @GetMapping("/versions/{versionId}/exports/pdf")
    public ResponseEntity<ByteArrayResource> exportPdf(
            @PathVariable UUID versionId,
            @RequestParam(required = false) List<Integer> occupancies
    ) {
        return download(service.exportPdf(versionId, occupancies));
    }

    private ResponseEntity<ByteArrayResource> download(InvestmentModels.DownloadFile file) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.mediaType()))
                .contentLength(file.bytes().length)
                .header(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(file.fileName(), StandardCharsets.UTF_8).build().toString())
                .body(new ByteArrayResource(file.bytes()));
    }
}
