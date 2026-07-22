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

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/daily-operations")
public class DailyOperationsController {
    private final IssueService issueService;

    public DailyOperationsController(IssueService issueService) {
        this.issueService = issueService;
    }

    @GetMapping("/issues")
    public List<Map<String, Object>> issues(
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String severity
    ) {
        return issueService.list(orgUnitId, businessDate, status, severity);
    }

    @PostMapping("/issues")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> createIssue(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.CreateIssue request
    ) {
        return issueService.create(request, idempotencyKey);
    }

    @GetMapping("/issues/{issueId}")
    public Map<String, Object> issue(@PathVariable UUID issueId) {
        return issueService.detail(issueId);
    }

    @PostMapping("/issues/{issueId}/sources")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addSource(
            @PathVariable UUID issueId,
            @Valid @RequestBody OperationModels.AddIssueSource request
    ) {
        return issueService.addSource(issueId, request);
    }

    @PostMapping("/issues/{issueId}/actions/{command}")
    public Map<String, Object> issueCommand(
            @PathVariable UUID issueId,
            @PathVariable String command,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody OperationModels.IssueCommand request
    ) {
        return issueService.command(issueId, command, idempotencyKey, request);
    }
}
