package cn.sifangguan.hotelaios.dailyoperations;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Component
public class TaskCandidateSyncListener {
    private static final Logger log = LoggerFactory.getLogger(TaskCandidateSyncListener.class);

    private final TaskCandidateService taskCandidateService;

    public TaskCandidateSyncListener(TaskCandidateService taskCandidateService) {
        this.taskCandidateService = taskCandidateService;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onSyncRequested(TaskCandidateService.CandidateSyncRequested event) {
        try {
            taskCandidateService.syncConfirmedCandidate(event.candidateId());
        } catch (RuntimeException exception) {
            log.atWarn()
                    .addKeyValue("task_candidate_id", event.candidateId())
                    .addKeyValue("correlation_id", event.correlationId())
                    .setCause(exception)
                    .log("Task candidate sync failed and will remain visible for retry");
            taskCandidateService.markSyncFailed(event.candidateId(), exception);
        }
    }
}
