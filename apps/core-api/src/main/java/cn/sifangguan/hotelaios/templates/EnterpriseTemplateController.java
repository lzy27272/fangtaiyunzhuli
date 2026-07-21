package cn.sifangguan.hotelaios.templates;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/templates")
public class EnterpriseTemplateController {
    private final EnterpriseTemplateService service;

    public EnterpriseTemplateController(EnterpriseTemplateService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String type) {
        return service.list(type);
    }

    @GetMapping("/{templateId}")
    public Map<String, Object> detail(@PathVariable UUID templateId) {
        return service.detail(templateId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@Valid @RequestBody EnterpriseTemplateModels.CreateTemplate request) {
        return service.create(request);
    }

    @PostMapping("/{templateId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createVersion(
            @PathVariable UUID templateId,
            @Valid @RequestBody EnterpriseTemplateModels.CreateVersion request
    ) {
        return service.createVersion(templateId, request);
    }

    @PutMapping("/{templateId}/versions/{versionId}")
    public Map<String, Object> updateVersion(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @Valid @RequestBody EnterpriseTemplateModels.UpdateVersion request
    ) {
        return service.updateVersion(templateId, versionId, request);
    }

    @PostMapping("/{templateId}/versions/{versionId}/publish")
    public Map<String, Object> publish(
            @PathVariable UUID templateId,
            @PathVariable UUID versionId,
            @RequestBody(required = false) EnterpriseTemplateModels.PublishVersion request
    ) {
        return service.publish(templateId, versionId, request);
    }
}
