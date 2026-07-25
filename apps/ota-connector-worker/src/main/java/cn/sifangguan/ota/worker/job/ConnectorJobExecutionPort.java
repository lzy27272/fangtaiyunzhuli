package cn.sifangguan.ota.worker.job;

public interface ConnectorJobExecutionPort {
    JobExecutionOutcome execute(ClaimedCollectionJob job);
}
