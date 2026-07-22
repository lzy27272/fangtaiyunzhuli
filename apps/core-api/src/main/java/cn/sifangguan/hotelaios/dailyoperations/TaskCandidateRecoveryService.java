package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.events.TenantSystemAccountResolver;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class TaskCandidateRecoveryService {
    private final TaskCandidateService taskCandidateService;
    private final TenantSystemAccountResolver systemAccountResolver;

    public TaskCandidateRecoveryService(
            TaskCandidateService taskCandidateService,
            TenantSystemAccountResolver systemAccountResolver
    ) {
        this.taskCandidateService = taskCandidateService;
        this.systemAccountResolver = systemAccountResolver;
    }

    public RecoveryResult processTenant(UUID tenantId, int batchSize, UUID correlationId) {
        UUID actorId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantPrincipal system = new TenantPrincipal(
                tenantId, actorId, "SYSTEM_AUTOMATION", Set.of("SYSTEM_AUTOMATION"),
                Set.of("task-candidate.retry"), Set.of(), Set.of(), true, correlationId);
        TenantContext.set(system);
        int succeeded = 0;
        int failed = 0;
        try {
            List<UUID> candidateIds = taskCandidateService.pendingForRecovery(batchSize);
            for (UUID candidateId : candidateIds) {
                try {
                    taskCandidateService.syncConfirmedCandidate(candidateId);
                    succeeded++;
                } catch (RuntimeException exception) {
                    failed++;
                    taskCandidateService.markSyncFailed(candidateId, exception);
                }
            }
            return new RecoveryResult(candidateIds.size(), succeeded, failed);
        } finally {
            if (previous == null) TenantContext.clear(); else TenantContext.set(previous);
        }
    }

    public record RecoveryResult(int processed, int succeeded, int failed) {
    }
}
