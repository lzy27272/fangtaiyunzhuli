package cn.sifangguan.ota.worker.job;

public enum JobExecutionStatus {
    RESULT_RECEIVED,
    LEASE_EXPIRED,
    EXECUTION_TIMEOUT,
    CONNECTOR_NOT_REGISTERED,
    UNSUPPORTED_STREAM,
    EXECUTION_FAILED
}
