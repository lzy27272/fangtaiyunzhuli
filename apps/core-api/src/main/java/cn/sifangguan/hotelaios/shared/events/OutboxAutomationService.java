package cn.sifangguan.hotelaios.shared.events;

import cn.sifangguan.hotelaios.rules.RuleService;
import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class OutboxAutomationService {
    private static final Logger log = LoggerFactory.getLogger(OutboxAutomationService.class);

    private final OutboxProjector projector;
    private final RuleService ruleService;
    private final TenantSystemAccountResolver systemAccountResolver;

    public OutboxAutomationService(
            OutboxProjector projector,
            RuleService ruleService,
            TenantSystemAccountResolver systemAccountResolver
    ) {
        this.projector = projector;
        this.ruleService = ruleService;
        this.systemAccountResolver = systemAccountResolver;
    }

    public OutboxProjector.ProjectionResult process(OutboxCreatedEvent event) {
        return projectAndConsume(event.tenantId(), event.outboxEventId(), event.correlationId());
    }

    public List<OutboxProjector.ProjectionResult> recover(UUID tenantId, UUID correlationId, int limit) {
        return recoverDetailed(tenantId, correlationId, limit, "manual-recovery:" + correlationId).projections();
    }

    public RecoveryResult recoverDetailed(
            UUID tenantId,
            UUID correlationId,
            int limit,
            String workerId
    ) {
        List<OutboxProjector.ProjectionResult> projections = projector.projectPending(tenantId, limit, workerId);
        Set<UUID> attemptedManagementEvents = new LinkedHashSet<>();
        int projectionFailures = 0;
        int consumed = 0;
        int consumptionFailures = 0;
        for (OutboxProjector.ProjectionResult projection : projections) {
            if ("FAILED".equals(projection.status())) {
                projectionFailures++;
            }
            UUID managementEventId = projection.managementEventId();
            if (managementEventId != null && attemptedManagementEvents.add(managementEventId)) {
                ConsumptionOutcome outcome = consumeAsSystem(tenantId, managementEventId, correlationId);
                consumed += outcome == ConsumptionOutcome.PROCESSED ? 1 : 0;
                consumptionFailures += outcome == ConsumptionOutcome.FAILED ? 1 : 0;
            }
        }
        for (UUID managementEventId : projector.findRecoverableManagementEvents(tenantId, limit)) {
            if (!attemptedManagementEvents.add(managementEventId)) {
                continue;
            }
            ConsumptionOutcome outcome = consumeAsSystem(tenantId, managementEventId, correlationId);
            consumed += outcome == ConsumptionOutcome.PROCESSED ? 1 : 0;
            consumptionFailures += outcome == ConsumptionOutcome.FAILED ? 1 : 0;
        }
        return new RecoveryResult(
                List.copyOf(new ArrayList<>(projections)),
                projections.size() - projectionFailures,
                projectionFailures,
                consumed,
                consumptionFailures,
                projector.countDeadLetters(tenantId),
                projector.countManagementEventDeadLetters(tenantId)
        );
    }

    private OutboxProjector.ProjectionResult projectAndConsume(
            UUID tenantId,
            UUID outboxEventId,
            UUID correlationId
    ) {
        OutboxProjector.ProjectionResult result = projector.projectOne(
                tenantId, outboxEventId, "after-commit:" + correlationId);
        consumeAsSystem(tenantId, result.managementEventId(), correlationId);
        return result;
    }

    private ConsumptionOutcome consumeAsSystem(UUID tenantId, UUID managementEventId, UUID correlationId) {
        if (managementEventId == null) {
            return ConsumptionOutcome.SKIPPED;
        }
        UUID systemAccountId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantContext.set(new TenantPrincipal(
                tenantId,
                systemAccountId,
                "SYSTEM_AUTOMATION",
                Set.of("SYSTEM_AUTOMATION"),
                Set.of("rule.manage", "task.create", "task.dispatch", "notification.read"),
                Set.of(),
                Set.of(),
                true,
                correlationId
        ));
        try {
            Map<String, Object> result = ruleService.consume(managementEventId);
            Object eventValue = result.get("event");
            if (eventValue instanceof Map<?, ?> event
                    && "PROCESSED".equals(String.valueOf(event.get("processing_status")))) {
                return ConsumptionOutcome.PROCESSED;
            }
            projector.scheduleManagementEventRetry(
                    tenantId, managementEventId, "one or more rule actions failed");
            return ConsumptionOutcome.FAILED;
        } catch (ResponseStatusException exception) {
            if (exception.getStatusCode().value() == 409) {
                return ConsumptionOutcome.SKIPPED;
            }
            log.warn("Management event recovery failed for tenant {} event {}", tenantId, managementEventId, exception);
            projector.scheduleManagementEventRetry(tenantId, managementEventId, safeMessage(exception));
            return ConsumptionOutcome.FAILED;
        } catch (RuntimeException exception) {
            log.warn("Management event recovery failed for tenant {} event {}", tenantId, managementEventId, exception);
            projector.scheduleManagementEventRetry(tenantId, managementEventId, safeMessage(exception));
            return ConsumptionOutcome.FAILED;
        } finally {
            if (previous == null) {
                TenantContext.clear();
            } else {
                TenantContext.set(previous);
            }
        }
    }

    private String safeMessage(RuntimeException exception) {
        String message = exception.getMessage();
        if (message == null || message.isBlank()) {
            message = exception.getClass().getSimpleName();
        }
        return message.length() <= 4000 ? message : message.substring(0, 4000);
    }

    private enum ConsumptionOutcome {
        PROCESSED,
        FAILED,
        SKIPPED
    }

    public record RecoveryResult(
            List<OutboxProjector.ProjectionResult> projections,
            int projectedCount,
            int projectionFailures,
            int consumedCount,
            int consumptionFailures,
            int deadLetterCount,
            int managementEventDeadLetterCount
    ) {
        public boolean hasFailures() {
            return projectionFailures > 0 || consumptionFailures > 0
                    || deadLetterCount > 0 || managementEventDeadLetterCount > 0;
        }
    }
}
