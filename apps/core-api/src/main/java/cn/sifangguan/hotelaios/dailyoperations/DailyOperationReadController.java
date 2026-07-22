package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.ActionItemView;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.DailyOperationOverview;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/daily-operations")
public class DailyOperationReadController {
    private final DailyOperationReadService readService;
    private final OperationSnapshotService snapshotService;

    public DailyOperationReadController(
            DailyOperationReadService readService,
            OperationSnapshotService snapshotService
    ) {
        this.readService = readService;
        this.snapshotService = snapshotService;
    }

    @GetMapping
    public DailyOperationOverview overview(
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false, defaultValue = "REALTIME") String mode,
            @RequestParam(required = false) UUID snapshotId
    ) {
        String normalizedMode = mode.trim().toUpperCase(Locale.ROOT);
        return switch (normalizedMode) {
            case "REALTIME" -> readService.realTimeOverview(orgUnitId, businessDate);
            case "SNAPSHOT" -> snapshotService.latestOverview(orgUnitId, businessDate, snapshotId);
            default -> throw new IllegalArgumentException("mode只支持REALTIME或SNAPSHOT");
        };
    }

    @GetMapping("/action-items")
    public List<ActionItemView> actionItems(
            @RequestParam(required = false) UUID orgUnitId,
            @RequestParam(required = false) LocalDate businessDate,
            @RequestParam(required = false) String status
    ) {
        return readService.actionItems(orgUnitId, businessDate, status);
    }
}
