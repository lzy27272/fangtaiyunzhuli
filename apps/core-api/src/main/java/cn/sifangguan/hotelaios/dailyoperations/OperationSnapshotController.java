package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.CreateSnapshotRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.RetrySnapshotRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.SnapshotDetail;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.SnapshotSummary;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/daily-operation-snapshots")
public class OperationSnapshotController {
    private final OperationSnapshotService service;

    public OperationSnapshotController(OperationSnapshotService service) {
        this.service = service;
    }

    @GetMapping
    public List<SnapshotSummary> list(
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) LocalDate businessDate
    ) {
        return service.list(orgUnitId, businessDate);
    }

    @PostMapping
    @org.springframework.web.bind.annotation.ResponseStatus(org.springframework.http.HttpStatus.CREATED)
    public SnapshotSummary create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateSnapshotRequest request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{snapshotId}")
    public SnapshotDetail detail(@PathVariable UUID snapshotId) {
        return service.detail(snapshotId);
    }

    @PostMapping("/{snapshotId}/retry")
    public SnapshotSummary retry(
            @PathVariable UUID snapshotId,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody RetrySnapshotRequest request
    ) {
        return service.retry(snapshotId, request, idempotencyKey);
    }
}
