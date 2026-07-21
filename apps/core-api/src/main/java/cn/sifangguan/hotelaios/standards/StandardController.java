package cn.sifangguan.hotelaios.standards;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/standards")
public class StandardController {
    private final StandardService service;

    public StandardController(StandardService service) {
        this.service = service;
    }

    @GetMapping("/categories")
    public List<Map<String, Object>> categories() {
        return service.categories();
    }

    @GetMapping
    public List<Map<String, Object>> standards() {
        return service.standards();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@Valid @RequestBody StandardModels.CreateStandard request) {
        return service.createStandard(request);
    }

    @PostMapping("/{standardId}/versions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createVersion(
            @PathVariable UUID standardId,
            @Valid @RequestBody StandardModels.CreateVersion request
    ) {
        return service.createVersion(standardId, request);
    }

    @PostMapping("/{standardId}/versions/{versionId}/publish")
    public Map<String, Object> publish(
            @PathVariable UUID standardId,
            @PathVariable UUID versionId,
            @Valid @RequestBody StandardModels.PublishVersion request
    ) {
        return service.publish(standardId, versionId, request);
    }
}

