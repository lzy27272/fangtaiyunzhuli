package cn.sifangguan.hotelaios.performance;

import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kpi/source-preview")
public class KpiSourcePreviewController {
    private final KpiSourcePreviewService service;

    public KpiSourcePreviewController(KpiSourcePreviewService service) {
        this.service = service;
    }

    @GetMapping("/catalog")
    public Map<String, Object> catalog(@RequestParam UUID templateVersionId) {
        return service.catalog(templateVersionId);
    }

    @PostMapping("/actions/calculate")
    public Map<String, Object> calculate(@Valid @RequestBody KpiModels.CalculateSourcePreview request) {
        return service.calculate(request);
    }
}
