package cn.sifangguan.hotelaios.rules;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/rules")
public class RuleController {
    private final RuleService service;

    public RuleController(RuleService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@Valid @RequestBody RuleModels.CreateRule request) {
        return service.create(request);
    }

    @GetMapping("/{ruleId}")
    public Map<String, Object> detail(@PathVariable UUID ruleId) {
        return service.detail(ruleId);
    }

    @PostMapping("/{ruleId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createVersion(
            @PathVariable UUID ruleId,
            @Valid @RequestBody RuleModels.CreateVersion request
    ) {
        return service.createVersion(ruleId, request);
    }

    @PutMapping("/{ruleId}/versions/{versionId}")
    public Map<String, Object> updateVersion(
            @PathVariable UUID ruleId,
            @PathVariable UUID versionId,
            @Valid @RequestBody RuleModels.UpdateVersion request
    ) {
        return service.updateVersion(ruleId, versionId, request);
    }

    @PostMapping("/{ruleId}/versions/{versionId}/validate")
    public Map<String, Object> validate(@PathVariable UUID ruleId, @PathVariable UUID versionId) {
        return service.validate(ruleId, versionId);
    }

    @PostMapping("/{ruleId}/versions/{versionId}/simulate")
    public Map<String, Object> simulate(
            @PathVariable UUID ruleId,
            @PathVariable UUID versionId,
            @Valid @RequestBody RuleModels.Simulation request
    ) {
        return service.simulate(ruleId, versionId, request);
    }

    @PostMapping("/{ruleId}/versions/{versionId}/publish")
    public Map<String, Object> publish(
            @PathVariable UUID ruleId,
            @PathVariable UUID versionId,
            @Valid @RequestBody RuleModels.PublishVersion request
    ) {
        return service.publish(ruleId, versionId, request);
    }

    @PostMapping("/{ruleId}/versions/{versionId}/disable")
    public Map<String, Object> disable(
            @PathVariable UUID ruleId,
            @PathVariable UUID versionId,
            @Valid @RequestBody RuleModels.DisableVersion request
    ) {
        return service.disable(ruleId, versionId, request.expectedVersion());
    }
}
