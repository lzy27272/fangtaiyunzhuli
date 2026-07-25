package cn.sifangguan.hotelaios.dailyreports;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.events.TenantSystemAccountResolver;
import cn.sifangguan.hotelaios.shared.time.BusinessDayService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class DailyReportDispatchService {
    private static final Logger log = LoggerFactory.getLogger(DailyReportDispatchService.class);
    private static final int MAX_BATCH_SIZE = 500;

    private final TenantSystemAccountResolver systemAccountResolver;
    private final BusinessDayService businessDayService;
    private final DailyReportDispatchTransactionService transactions;
    private final Map<UUID, DispatchCursor> cursors = new ConcurrentHashMap<>();

    public DailyReportDispatchService(
            TenantSystemAccountResolver systemAccountResolver,
            BusinessDayService businessDayService,
            DailyReportDispatchTransactionService transactions
    ) {
        this.systemAccountResolver = systemAccountResolver;
        this.businessDayService = businessDayService;
        this.transactions = transactions;
    }

    public ProcessResult processTenantAsSystem(UUID tenantId, int batchLimit, UUID correlationId) {
        return processTenantAsSystem(tenantId, batchLimit, correlationId, Instant.now());
    }

    ProcessResult processTenantAsSystem(
            UUID tenantId,
            int batchLimit,
            UUID correlationId,
            Instant now
    ) {
        if (batchLimit < 1 || batchLimit > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException("batchLimit must be between 1 and " + MAX_BATCH_SIZE);
        }
        UUID actorId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantPrincipal systemPrincipal = new TenantPrincipal(
                tenantId,
                actorId,
                "SYSTEM_AUTOMATION",
                Set.of("SYSTEM_AUTOMATION"),
                Set.of("daily-report-template.read", "daily-report.read"),
                Set.of(),
                Set.of(),
                true,
                correlationId);
        TenantContext.set(systemPrincipal);
        int scanned = 0;
        int processed = 0;
        int created = 0;
        int openedEvents = 0;
        int dueSoonEvents = 0;
        int overdueEvents = 0;
        int failures = 0;
        try {
            DispatchCursor cursor = cursors.get(tenantId);
            List<DailyReportDispatchTransactionService.DispatchCandidate> candidates =
                    transactions.findCandidates(
                            batchLimit,
                            cursor == null ? null : cursor.assignmentId(),
                            cursor == null ? null : cursor.policyId());
            scanned = candidates.size();
            if (!candidates.isEmpty()) {
                DailyReportDispatchTransactionService.DispatchCandidate last = candidates.getLast();
                cursors.put(tenantId, new DispatchCursor(last.positionAssignmentId(), last.policyId()));
            }
            for (DailyReportDispatchTransactionService.DispatchCandidate candidate : candidates) {
                try {
                    BusinessDayService.BusinessDayContext current =
                            businessDayService.resolveCurrent(candidate.orgUnitId(), now);
                    for (int backfill = 0; backfill <= candidate.backfillDays(); backfill++) {
                        LocalDate businessDate = current.businessDate().minusDays(backfill);
                        try {
                            DailyReportDispatchTransactionService.DispatchOutcome outcome =
                                    transactions.materializeAndDispatch(candidate, businessDate, now);
                            if (outcome.processed()) {
                                processed++;
                            }
                            if (outcome.created()) {
                                created++;
                            }
                            if (outcome.openedEventCreated()) {
                                openedEvents++;
                            }
                            dueSoonEvents += outcome.dueSoonEventsCreated();
                            overdueEvents += outcome.overdueEventsCreated();
                        } catch (RuntimeException exception) {
                            failures++;
                            log.atWarn()
                                    .addKeyValue("tenant_id", tenantId)
                                    .addKeyValue("policy_id", candidate.policyId())
                                    .addKeyValue("position_assignment_id", candidate.positionAssignmentId())
                                    .addKeyValue("business_date", businessDate)
                                    .setCause(exception)
                                    .log("Daily report dispatch item failed; remaining assignments will continue");
                        }
                    }
                } catch (RuntimeException exception) {
                    failures++;
                    log.atWarn()
                            .addKeyValue("tenant_id", tenantId)
                            .addKeyValue("policy_id", candidate.policyId())
                            .addKeyValue("position_assignment_id", candidate.positionAssignmentId())
                            .setCause(exception)
                            .log("Daily report business-day resolution failed; remaining assignments will continue");
                }
            }
            return new ProcessResult(
                    scanned,
                    processed,
                    created,
                    openedEvents,
                    dueSoonEvents,
                    overdueEvents,
                    failures);
        } finally {
            if (previous == null) {
                TenantContext.clear();
            } else {
                TenantContext.set(previous);
            }
        }
    }

    public record ProcessResult(
            int scannedCandidates,
            int processedReports,
            int createdReports,
            int openedEvents,
            int dueSoonEvents,
            int overdueEvents,
            int failedItems
    ) {
    }

    private record DispatchCursor(UUID assignmentId, UUID policyId) {
    }
}
