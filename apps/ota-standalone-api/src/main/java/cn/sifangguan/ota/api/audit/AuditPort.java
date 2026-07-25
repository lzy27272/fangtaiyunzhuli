package cn.sifangguan.ota.api.audit;

public interface AuditPort {
    /** Independent failure/denial evidence that must survive a caller rollback. */
    void append(AuditEvent event);

    /** Success evidence that must commit or roll back atomically with the protected mutation. */
    default void appendInCurrentTransaction(AuditEvent event) {
        append(event);
    }
}
