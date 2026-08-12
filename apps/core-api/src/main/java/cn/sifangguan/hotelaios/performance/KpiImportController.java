package cn.sifangguan.hotelaios.performance;

import jakarta.validation.Valid;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kpi/imports")
public class KpiImportController {
    private final KpiImportService service;

    public KpiImportController(KpiImportService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return service.list();
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> upload(@RequestPart("file") MultipartFile file) {
        return service.upload(file);
    }

    @PostMapping("/{jobId}/actions/apply")
    public Map<String, Object> apply(
            @PathVariable UUID jobId,
            @Valid @RequestBody KpiModels.ImportMapping request
    ) {
        return service.apply(jobId, request);
    }

    @PostMapping("/{jobId}/actions/generate-drafts")
    public Map<String, Object> generateDrafts(
            @PathVariable UUID jobId,
            @Valid @RequestBody KpiModels.SmartImportRequest request
    ) {
        return service.generateDrafts(jobId, request);
    }

    @GetMapping("/{jobId}/original")
    public ResponseEntity<byte[]> original(@PathVariable UUID jobId) {
        KpiImportService.ImportFile file = service.original(jobId);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(file.mediaType()));
        headers.setContentDisposition(ContentDisposition.attachment()
                .filename(file.name(), StandardCharsets.UTF_8).build());
        return new ResponseEntity<>(file.content(), headers, HttpStatus.OK);
    }
}
