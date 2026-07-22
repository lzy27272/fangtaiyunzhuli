package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.workdata.AttachmentService;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/** Retention cleanup for completed export files; database metadata is cleared only after file deletion succeeds. */
@Service
public class OperationExportExpiryService {
    private final OperationExportJobTransactions transactions;
    private final AttachmentService attachmentService;

    public OperationExportExpiryService(
            OperationExportJobTransactions transactions,
            AttachmentService attachmentService
    ) {
        this.transactions = transactions;
        this.attachmentService = attachmentService;
    }

    public CleanupResult cleanupTenant(UUID tenantId, int batchSize) {
        int limit = Math.max(1, Math.min(batchSize, 500));
        int processed = 0;
        int cleaned = 0;
        int failed = 0;
        for (ExpiredExportObject succeeded : transactions.succeededObjectsForMaintenance(tenantId, limit)) {
            try {
                attachmentService.cleanupGeneratedExportJob(
                        succeeded.tenantId(), succeeded.jobId(), succeeded.objectKey());
            } catch (RuntimeException exception) {
                failed++;
            }
        }
        while (processed < limit) {
            Optional<ExpiredExportObject> claimed = transactions.claimExpired(tenantId, null);
            if (claimed.isEmpty()) break;
            processed++;
            if (cleanup(claimed.orElseThrow())) cleaned++; else failed++;
        }
        return new CleanupResult(processed, cleaned, failed);
    }

    /** Best-effort synchronous cleanup used by an expired download request. */
    public boolean cleanupForCurrentTenant(UUID jobId) {
        UUID tenantId = TenantContext.require().tenantId();
        Optional<ExpiredExportObject> claimed = transactions.claimExpired(tenantId, jobId);
        return claimed.isPresent() && cleanup(claimed.orElseThrow());
    }

    private boolean cleanup(ExpiredExportObject object) {
        try {
            attachmentService.cleanupGeneratedExportJob(object.tenantId(), object.jobId(), null);
            return transactions.finalizeExpired(object);
        } catch (RuntimeException exception) {
            try {
                transactions.recordExpiryFailure(object, exception);
            } catch (RuntimeException persistenceFailure) {
                exception.addSuppressed(persistenceFailure);
            }
            return false;
        }
    }

    public record CleanupResult(int processed, int cleaned, int failed) {
    }
}
