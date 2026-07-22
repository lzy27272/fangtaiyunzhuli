package cn.sifangguan.hotelaios.dailyoperations;

import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/task-candidates")
public class TaskCandidateController {
    private final TaskCandidateService service;

    public TaskCandidateController(TaskCandidateService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) String status
    ) {
        return service.list(orgUnitId, status);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.CreateTaskCandidate request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{candidateId}")
    public Map<String, Object> detail(@PathVariable UUID candidateId) {
        return service.detail(candidateId);
    }

    @PostMapping("/{candidateId}/confirm")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> confirm(
            @PathVariable UUID candidateId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.CandidateDecision request
    ) {
        return service.confirm(candidateId, idempotencyKey, request);
    }

    @PostMapping("/{candidateId}/reject")
    public Map<String, Object> reject(
            @PathVariable UUID candidateId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.CandidateDecision request
    ) {
        return service.reject(candidateId, idempotencyKey, request);
    }

    @PostMapping("/{candidateId}/sync")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public Map<String, Object> retry(
            @PathVariable UUID candidateId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.CandidateDecision request
    ) {
        return service.retry(candidateId, idempotencyKey, request);
    }
}
