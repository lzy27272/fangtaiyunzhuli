package cn.sifangguan.ota.api.tenancy;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.DefaultTransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

public final class PostgresRlsTenantContextExecutor implements TenantContextExecutor {
    private final JdbcTemplate jdbc;
    private final PlatformTransactionManager transactionManager;

    public PostgresRlsTenantContextExecutor(JdbcTemplate jdbc, PlatformTransactionManager transactionManager) {
        this.jdbc = jdbc;
        this.transactionManager = transactionManager;
    }

    @Override
    public <T> T inTenant(UUID tenantId, boolean readOnly, Supplier<T> work) {
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(work, "work");
        DefaultTransactionDefinition definition = new DefaultTransactionDefinition();
        definition.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        definition.setReadOnly(readOnly);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager, definition);
        return transaction.execute(status -> {
            jdbc.queryForObject("select set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
            UUID confirmed = jdbc.queryForObject("select control.current_tenant_id()", UUID.class);
            if (!tenantId.equals(confirmed)) {
                throw new IllegalStateException("Tenant RLS context was not established");
            }
            return work.get();
        });
    }
}
