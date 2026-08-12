package cn.sifangguan.hotelaios.performance;

import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/kpi/exports")
public class KpiExportController {
    private final KpiExportService service;

    public KpiExportController(KpiExportService service) {
        this.service = service;
    }

    @GetMapping("/scorecards.csv")
    public ResponseEntity<byte[]> scorecards(@RequestParam(required = false) UUID periodId) {
        return response(service.scorecards(periodId));
    }

    @GetMapping("/settlements.csv")
    public ResponseEntity<byte[]> settlements(@RequestParam(required = false) UUID periodId) {
        return response(service.settlements(periodId));
    }

    private ResponseEntity<byte[]> response(KpiExportService.ExportFile file) {
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(file.mediaType()))
                .contentLength(file.content().length)
                .header(HttpHeaders.CACHE_CONTROL, "no-store, max-age=0")
                .header(HttpHeaders.PRAGMA, "no-cache")
                .header(HttpHeaders.CONTENT_DISPOSITION, ContentDisposition.attachment()
                        .filename(file.name(), StandardCharsets.UTF_8).build().toString())
                .body(file.content());
    }
}
