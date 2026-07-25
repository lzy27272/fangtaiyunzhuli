package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.job.ClaimedCollectionJob;

@FunctionalInterface
public interface ConnectorContractExecutionPreflight {
    void verifyBeforeExecution(
            ClaimedCollectionJob job,
            SourceConnector connector);
}
