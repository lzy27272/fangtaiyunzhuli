package cn.sifangguan.hotelaios.workpackage;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Component
@ConditionalOnProperty(
        prefix = "app.work-expectation.sla",
        name = "scheduler-enabled",
        havingValue = "true"
)
public class WorkExpectationSlaScheduler {
    private static final Logger log = LoggerFactory.getLogger(WorkExpectationSlaScheduler.class);

    private final WorkExpectationSlaService service;
    private final int batchSize;
    private final List<UUID> tenantIds;

    public WorkExpectationSlaScheduler(
            WorkExpectationSlaService service,
            @Value("${app.work-expectation.sla.batch-size:100}") int batchSize,
            @Value("${app.work-expectation.sla.tenant-ids:}") String tenantIds
    ) {
        this.service = service;
        this.batchSize = batchSize;
        this.tenantIds = parseTenantIds(tenantIds);
        if (this.tenantIds.isEmpty()) {
            log.warn("Work-expectation SLA scheduler is enabled without valid tenant IDs; no tenant will be processed");
        }
    }

    @Scheduled(
            fixedDelayString = "${app.work-expectation.sla.fixed-delay-ms:60000}",
            initialDelayString = "${app.work-expectation.sla.initial-delay-ms:30000}"
    )
    public void processConfiguredTenants() {
        for (UUID tenantId : tenantIds) {
            try {
                WorkPackageModels.SlaProcessResult result = service.processTenantAsSystem(
                        tenantId, batchSize, UUID.randomUUID());
                if (result.processedCount() > 0) {
                    log.info("Marked {} overdue work expectations MISSED for tenant {}",
                            result.processedCount(), tenantId);
                }
            } catch (RuntimeException exception) {
                log.error("Work-expectation SLA processing failed for tenant {}", tenantId, exception);
            }
        }
    }

    private static List<UUID> parseTenantIds(String configured) {
        if (configured == null || configured.isBlank()) {
            return List.of();
        }
        List<UUID> parsed = new ArrayList<>();
        try {
            for (String value : configured.split(",")) {
                if (!value.isBlank()) {
                    parsed.add(UUID.fromString(value.trim()));
                }
            }
            return List.copyOf(parsed);
        } catch (IllegalArgumentException exception) {
            log.error("Invalid WORK_EXPECTATION_SLA_TENANT_IDS configuration; scheduler will fail closed");
            return List.of();
        }
    }
}
