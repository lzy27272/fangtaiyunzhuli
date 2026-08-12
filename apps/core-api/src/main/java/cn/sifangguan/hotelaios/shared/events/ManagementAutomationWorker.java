package cn.sifangguan.hotelaios.shared.events;

import cn.sifangguan.hotelaios.dailyoperations.OperationExportProcessor;
import cn.sifangguan.hotelaios.dailyoperations.TaskCandidateRecoveryService;
import cn.sifangguan.hotelaios.dailyreports.DailyReportDispatchService;
import cn.sifangguan.hotelaios.performance.KpiAutomationService;
import cn.sifangguan.hotelaios.tasks.TaskService;
import cn.sifangguan.hotelaios.workpackage.WorkPackageModels;
import cn.sifangguan.hotelaios.workpackage.WorkExpectationSlaService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Tenant-scoped background worker for the management closed loop.
 *
 * <p>The explicit tenant allow-list is intentional: runtime database roles are RLS-bound and must not
 * enumerate other tenants. Each pipeline establishes its own tenant system identity and transaction.</p>
 */
@Component
@ConditionalOnProperty(
        prefix = "app.automation.worker",
        name = "enabled",
        havingValue = "true"
)
public class ManagementAutomationWorker {
    private static final Logger log = LoggerFactory.getLogger(ManagementAutomationWorker.class);

    private final WorkExpectationSlaService workExpectationSlaService;
    private final DailyReportDispatchService dailyReportDispatchService;
    private final OutboxAutomationService outboxAutomationService;
    private final TaskCandidateRecoveryService taskCandidateRecoveryService;
    private final OperationExportProcessor operationExportProcessor;
    private final TaskService taskService;
    private final KpiAutomationService kpiAutomationService;
    private final AutomationWorkerMetrics metrics;
    private final List<UUID> tenantIds;
    private final int batchSize;
    private final String workerId = "management-automation:" + UUID.randomUUID();

    public ManagementAutomationWorker(
            WorkExpectationSlaService workExpectationSlaService,
            DailyReportDispatchService dailyReportDispatchService,
            OutboxAutomationService outboxAutomationService,
            TaskCandidateRecoveryService taskCandidateRecoveryService,
            OperationExportProcessor operationExportProcessor,
            TaskService taskService,
            KpiAutomationService kpiAutomationService,
            AutomationWorkerMetrics metrics,
            @Value("${app.automation.worker.tenant-ids:}") String tenantIds,
            @Value("${app.automation.worker.batch-size:100}") int batchSize
    ) {
        this.workExpectationSlaService = workExpectationSlaService;
        this.dailyReportDispatchService = dailyReportDispatchService;
        this.outboxAutomationService = outboxAutomationService;
        this.taskCandidateRecoveryService = taskCandidateRecoveryService;
        this.operationExportProcessor = operationExportProcessor;
        this.taskService = taskService;
        this.kpiAutomationService = kpiAutomationService;
        this.metrics = metrics;
        this.tenantIds = parseTenantIds(tenantIds);
        if (this.tenantIds.isEmpty()) {
            throw new IllegalStateException(
                    "app.automation.worker.tenant-ids must contain at least one tenant when the worker is enabled");
        }
        if (batchSize < 1 || batchSize > 500) {
            throw new IllegalArgumentException("app.automation.worker.batch-size must be between 1 and 500");
        }
        this.batchSize = batchSize;
    }

    @Scheduled(
            fixedDelayString = "${app.automation.worker.fixed-delay-ms:60000}",
            initialDelayString = "${app.automation.worker.initial-delay-ms:30000}"
    )
    public void runScheduledCycle() {
        for (UUID tenantId : tenantIds) {
            UUID correlationId = UUID.randomUUID();
            processWorkExpectations(tenantId, correlationId);
            processDailyReports(tenantId, correlationId);
            processEventQueues(tenantId, correlationId);
            processTaskCandidateSync(tenantId, correlationId);
            processOperationExports(tenantId, correlationId);
            processTaskSla(tenantId, correlationId);
            processKpi(tenantId, correlationId);
        }
    }

    private void processKpi(UUID tenantId, UUID correlationId) {
        String pipeline = "kpi_automation";
        Instant startedAt = Instant.now();
        try {
            kpiAutomationService.processTenant(tenantId, correlationId);
            metrics.success(pipeline, 1, Duration.between(startedAt, Instant.now()));
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processDailyReports(UUID tenantId, UUID correlationId) {
        String pipeline = "daily_report_dispatch";
        Instant startedAt = Instant.now();
        try {
            DailyReportDispatchService.ProcessResult result =
                    dailyReportDispatchService.processTenantAsSystem(tenantId, batchSize, correlationId);
            int items = result.createdReports() + result.openedEvents()
                    + result.dueSoonEvents() + result.overdueEvents();
            metrics.success(pipeline, items, Duration.between(startedAt, Instant.now()));
            if (result.failedItems() > 0) {
                metrics.alert(pipeline, "ITEM_FAILURE");
                log.atWarn()
                        .addKeyValue("alert_code", "ITEM_FAILURE")
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("scanned_candidates", result.scannedCandidates())
                        .addKeyValue("created_reports", result.createdReports())
                        .addKeyValue("failed_items", result.failedItems())
                        .log("Daily report dispatch completed with isolated item failures");
            } else if (items > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("created_reports", result.createdReports())
                        .addKeyValue("due_soon_events", result.dueSoonEvents())
                        .addKeyValue("overdue_events", result.overdueEvents())
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processOperationExports(UUID tenantId, UUID correlationId) {
        String pipeline = "operation_export";
        Instant startedAt = Instant.now();
        try {
            OperationExportProcessor.ProcessingResult result = operationExportProcessor.processTenant(
                    tenantId, batchSize, correlationId);
            metrics.success(pipeline, result.processed() + result.expired(),
                    Duration.between(startedAt, Instant.now()));
            if (result.failed() + result.expiryFailed() > 0) {
                metrics.alert(pipeline, "EXPORT_JOB_FAILED");
                log.atWarn()
                        .addKeyValue("alert_code", "EXPORT_JOB_FAILED")
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("processed_count", result.processed())
                        .addKeyValue("export_failed_count", result.failed())
                        .addKeyValue("expiry_failed_count", result.expiryFailed())
                        .log("Operation export jobs completed with failures");
            } else if (result.processed() + result.expired() > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("succeeded_count", result.succeeded())
                        .addKeyValue("cleaned_expired_count", result.expired())
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processTaskCandidateSync(UUID tenantId, UUID correlationId) {
        String pipeline = "task_candidate_sync";
        Instant startedAt = Instant.now();
        try {
            TaskCandidateRecoveryService.RecoveryResult result = taskCandidateRecoveryService.processTenant(
                    tenantId, batchSize, correlationId);
            metrics.success(pipeline, result.processed(), Duration.between(startedAt, Instant.now()));
            if (result.failed() > 0) {
                metrics.alert(pipeline, "RETRY_SCHEDULED");
                log.atWarn()
                        .addKeyValue("alert_code", "RETRY_SCHEDULED")
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("processed_count", result.processed())
                        .addKeyValue("failed_count", result.failed())
                        .log("Task-candidate synchronization scheduled retries");
            } else if (result.processed() > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("succeeded_count", result.succeeded())
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processWorkExpectations(UUID tenantId, UUID correlationId) {
        String pipeline = "work_expectation_sla";
        Instant startedAt = Instant.now();
        try {
            WorkPackageModels.SlaProcessResult result = workExpectationSlaService.processTenantAsSystem(
                    tenantId, batchSize, correlationId);
            metrics.success(pipeline, result.processedCount(), Duration.between(startedAt, Instant.now()));
            if (result.processedCount() > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("processed_count", result.processedCount())
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processEventQueues(UUID tenantId, UUID correlationId) {
        String pipeline = "event_recovery";
        Instant startedAt = Instant.now();
        try {
            OutboxAutomationService.RecoveryResult result = outboxAutomationService.recoverDetailed(
                    tenantId, correlationId, batchSize, workerId);
            int items = result.projectedCount() + result.consumedCount();
            metrics.success(pipeline, items, Duration.between(startedAt, Instant.now()));
            metrics.deadLetters(result.deadLetterCount(), result.managementEventDeadLetterCount());
            if (result.hasFailures()) {
                String code = result.deadLetterCount() + result.managementEventDeadLetterCount() > 0
                        ? "DEAD_LETTER_PRESENT" : "RETRY_SCHEDULED";
                metrics.alert(pipeline, code);
                log.atError()
                        .addKeyValue("alert_code", code)
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("projection_failures", result.projectionFailures())
                        .addKeyValue("consumption_failures", result.consumptionFailures())
                        .addKeyValue("outbox_dead_letters", result.deadLetterCount())
                        .addKeyValue("management_event_dead_letters", result.managementEventDeadLetterCount())
                        .log("Automation worker requires operator attention");
            } else if (items > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("projected_count", result.projectedCount())
                        .addKeyValue("consumed_count", result.consumedCount())
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void processTaskSla(UUID tenantId, UUID correlationId) {
        String pipeline = "task_sla";
        Instant startedAt = Instant.now();
        try {
            Map<String, Object> result = taskService.processSlaAsSystem(
                    tenantId, batchSize, correlationId);
            int items = number(result, "overdueTasks") + number(result, "escalations")
                    + number(result, "cancelledEscalations");
            metrics.success(pipeline, items, Duration.between(startedAt, Instant.now()));
            if (items > 0) {
                log.atInfo()
                        .addKeyValue("pipeline", pipeline)
                        .addKeyValue("tenant_id", tenantId)
                        .addKeyValue("correlation_id", correlationId)
                        .addKeyValue("overdue_tasks", number(result, "overdueTasks"))
                        .addKeyValue("escalations", number(result, "escalations"))
                        .addKeyValue("notifications", number(result, "notifications"))
                        .log("Automation worker completed pipeline");
            }
        } catch (RuntimeException exception) {
            pipelineFailure(pipeline, tenantId, correlationId, startedAt, exception);
        }
    }

    private void pipelineFailure(
            String pipeline,
            UUID tenantId,
            UUID correlationId,
            Instant startedAt,
            RuntimeException exception
    ) {
        metrics.failure(pipeline, Duration.between(startedAt, Instant.now()));
        metrics.alert(pipeline, "PIPELINE_FAILURE");
        log.atError()
                .addKeyValue("alert_code", "PIPELINE_FAILURE")
                .addKeyValue("pipeline", pipeline)
                .addKeyValue("tenant_id", tenantId)
                .addKeyValue("correlation_id", correlationId)
                .setCause(exception)
                .log("Automation worker pipeline failed");
    }

    private static int number(Map<String, Object> values, String key) {
        Object value = values.get(key);
        return value instanceof Number number ? number.intValue() : 0;
    }

    private static List<UUID> parseTenantIds(String configured) {
        if (configured == null || configured.isBlank()) {
            return List.of();
        }
        List<UUID> parsed = new ArrayList<>();
        for (String value : configured.split(",")) {
            if (!value.isBlank()) {
                parsed.add(UUID.fromString(value.trim()));
            }
        }
        return List.copyOf(parsed);
    }
}
