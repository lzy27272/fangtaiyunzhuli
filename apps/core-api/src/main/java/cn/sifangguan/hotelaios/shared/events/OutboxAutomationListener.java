package cn.sifangguan.hotelaios.shared.events;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class OutboxAutomationListener {
    private static final Logger log = LoggerFactory.getLogger(OutboxAutomationListener.class);
    private final OutboxAutomationService automationService;

    public OutboxAutomationListener(OutboxAutomationService automationService) {
        this.automationService = automationService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void afterCommit(OutboxCreatedEvent event) {
        try {
            OutboxProjector.ProjectionResult result = automationService.process(event);
            if ("FAILED".equals(result.status())) {
                log.warn("Outbox projection failed for {}: {}", event.outboxEventId(), result.error());
            }
        } catch (RuntimeException exception) {
            log.error("Automatic rule pipeline failed for outbox {}", event.outboxEventId(), exception);
        }
    }
}
