package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.CreateExportRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.OperationExportView;
import jakarta.validation.Valid;
import org.springframework.core.io.Resource;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/daily-operations/exports")
public class OperationExportController {
    private final OperationExportService service;

    public OperationExportController(OperationExportService service) {
        this.service = service;
    }

    @GetMapping
    public List<OperationExportView> list() {
        return service.list();
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public OperationExportView create(
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateExportRequest request
    ) {
        return service.create(request, idempotencyKey);
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<Resource> download(@PathVariable UUID id) {
        var download = service.download(id);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(download.mediaType()))
                .contentLength(download.sizeBytes())
                .header(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header("Content-Disposition", ContentDisposition.attachment()
                        .filename(download.originalName(), StandardCharsets.UTF_8).build().toString())
                .body(download.resource());
    }
}
