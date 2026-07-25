package cn.sifangguan.ota.worker.job;

import java.time.Instant;
import java.util.Optional;

/** Database-backed claiming is a Sprint 1 adapter; Sprint 0 freezes only this boundary. */
public interface CollectionJobClaimPort {
    Optional<ClaimedCollectionJob> claimNext(WorkerIdentity worker, Instant now);
}
