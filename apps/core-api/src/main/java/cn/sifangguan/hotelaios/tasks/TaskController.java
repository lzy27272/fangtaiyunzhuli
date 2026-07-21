package cn.sifangguan.hotelaios.tasks;

import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/tasks")
public class TaskController {
    private final TaskService service;

    public TaskController(TaskService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) UUID orgUnitId
    ) {
        return service.list(status, orgUnitId);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody TaskModels.CreateTask request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{taskId}")
    public Map<String, Object> detail(@PathVariable UUID taskId) {
        return service.detail(taskId);
    }

    @GetMapping("/{taskId}/timeline")
    public List<Map<String, Object>> timeline(@PathVariable UUID taskId) {
        return service.timeline(taskId);
    }

    @PostMapping("/{taskId}/evidence")
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> addEvidence(
            @PathVariable UUID taskId,
            @Valid @RequestBody TaskModels.AddEvidence request
    ) {
        return service.addEvidence(taskId, request);
    }

    @PostMapping(value = "/{taskId}/evidence/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> uploadEvidence(
            @PathVariable UUID taskId,
            @RequestParam UUID submittedByAssignmentId,
            @RequestPart("file") MultipartFile file
    ) {
        return service.uploadEvidence(taskId, submittedByAssignmentId, file);
    }

    @GetMapping("/{taskId}/evidence/{evidenceId}/content")
    public ResponseEntity<org.springframework.core.io.Resource> evidenceContent(
            @PathVariable UUID taskId,
            @PathVariable UUID evidenceId
    ) {
        var download = service.evidenceContent(taskId, evidenceId);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(download.mediaType()))
                .contentLength(download.sizeBytes())
                .header("Content-Disposition", ContentDisposition.inline()
                        .filename(download.originalName(), StandardCharsets.UTF_8).build().toString())
                .body(download.resource());
    }

    @DeleteMapping("/{taskId}/evidence/{evidenceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteEvidence(
            @PathVariable UUID taskId,
            @PathVariable UUID evidenceId,
            @RequestParam UUID actorAssignmentId
    ) {
        service.deleteEvidence(taskId, evidenceId, actorAssignmentId);
    }

    @PostMapping("/{taskId}/actions/{command}")
    public Map<String, Object> command(
            @PathVariable UUID taskId,
            @PathVariable String command,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody TaskModels.Command request
    ) {
        return service.command(taskId, command, idempotencyKey, request);
    }

    @PostMapping("/sla/process")
    public Map<String, Object> processSla() {
        return service.processSla();
    }
}
