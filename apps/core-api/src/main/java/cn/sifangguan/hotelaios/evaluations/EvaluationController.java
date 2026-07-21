package cn.sifangguan.hotelaios.evaluations;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/standard-evaluations")
public class EvaluationController {
    private final EvaluationService service;

    public EvaluationController(EvaluationService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String outcome,
            @RequestParam(required = false) UUID orgUnitId
    ) {
        return service.list(outcome, orgUnitId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody EvaluationModels.CreateEvaluation request
    ) {
        return service.create(idempotencyKey, request);
    }

    @GetMapping("/{evaluationId}")
    public Map<String, Object> detail(@PathVariable UUID evaluationId) {
        return service.detail(evaluationId);
    }

    @PostMapping("/{evaluationId}/manual-review")
    public Map<String, Object> manualReview(
            @PathVariable UUID evaluationId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody EvaluationModels.ManualReview request
    ) {
        return service.manualReview(evaluationId, idempotencyKey, request);
    }
}
