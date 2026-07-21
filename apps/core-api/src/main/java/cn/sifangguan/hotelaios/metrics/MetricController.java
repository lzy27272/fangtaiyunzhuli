package cn.sifangguan.hotelaios.metrics;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/metrics")
public class MetricController {
    private final MetricService service;

    public MetricController(MetricService service) {
        this.service = service;
    }

    @GetMapping("/definitions")
    public List<Map<String, Object>> definitions() {
        return service.definitions();
    }

    @PostMapping("/definitions")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createDefinition(@Valid @RequestBody MetricModels.CreateMetric request) {
        return service.createDefinition(request);
    }

    @GetMapping("/observations")
    public List<Map<String, Object>> observations(
            @RequestParam UUID hotelId,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to
    ) {
        return service.observations(hotelId, from, to);
    }

    @PostMapping("/observations")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> record(@Valid @RequestBody MetricModels.RecordObservation request) {
        return service.record(request);
    }
}

