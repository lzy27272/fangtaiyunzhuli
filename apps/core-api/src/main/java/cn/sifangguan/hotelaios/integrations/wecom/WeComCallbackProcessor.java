package cn.sifangguan.hotelaios.integrations.wecom;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComCallbackProcessor {
    private static final Logger log = LoggerFactory.getLogger(WeComCallbackProcessor.class);
    private final WeComInboundReceiptService receipts;
    private final WeComIdentityResolver identities;
    private final WeComTaskCardActionService taskActions;

    public WeComCallbackProcessor(
            WeComInboundReceiptService receipts,
            WeComIdentityResolver identities,
            WeComTaskCardActionService taskActions
    ) {
        this.receipts = receipts;
        this.identities = identities;
        this.taskActions = taskActions;
    }

    @Async
    public void processNew(UUID receiptId, String fromUserId, String eventKey, UUID correlationId) {
        if (!receipts.begin(receiptId)) return;
        processClaimed(receiptId, fromUserId, eventKey, correlationId);
    }

    @Scheduled(fixedDelayString = "${app.wecom.callback-recovery-delay-ms:15000}", initialDelayString = "15000")
    public void recover() {
        for (WeComInboundReceiptService.Recovery row : receipts.claimRecoverable(50)) {
            processClaimed(row.id(), row.fromUserId(), row.eventKey(), row.correlationId());
        }
    }

    private void processClaimed(UUID receiptId, String fromUserId, String eventKey, UUID correlationId) {
        try {
            WeComIdentityResolver.ResolvedIdentity identity = identities.resolve(fromUserId, correlationId);
            taskActions.execute(identity, receiptId, eventKey);
            receipts.complete(receiptId, "SUCCEEDED");
        } catch (RuntimeException exception) {
            receipts.fail(receiptId, exception);
            log.warn("WeCom task-card callback was rejected; correlationId={}, type={}",
                    correlationId, exception.getClass().getSimpleName());
        }
    }
}
