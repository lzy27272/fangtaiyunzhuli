package cn.sifangguan.ota.worker.job;

import java.time.Instant;
/** Persists lease/result transitions without exposing connector credentials to the worker loop. */
public interface CollectionJobLeasePort {
    boolean renew(
            ClaimedCollectionJob job,
            WorkerIdentity worker,
            Instant now,
            Instant newExpiry);

    void record(
            ClaimedCollectionJob job,
            WorkerIdentity worker,
            JobExecutionOutcome outcome,
            Instant recordedAt);
}
