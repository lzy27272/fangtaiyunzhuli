package cn.sifangguan.hotelaios.shared.events;

import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

/** Resolves the reserved automation account inside the event's own tenant. */
@Component
public class TenantSystemAccountResolver {
    public static final String LOGIN_NAME = "system.automation";

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final TransactionTemplate requiresNew;

    public TenantSystemAccountResolver(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            PlatformTransactionManager transactionManager
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public UUID resolveOrCreate(UUID tenantId) {
        UUID accountId = requiresNew.execute(status -> {
            databaseContext.apply(tenantId);
            return jdbc.queryForObject("""
                    insert into user_account (tenant_id, login_name, display_name, status)
                    values (:tenantId, :loginName, :displayName, 'ACTIVE')
                    on conflict (tenant_id, login_name) do update
                    set display_name = excluded.display_name, status = 'ACTIVE'
                    returning id
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("loginName", LOGIN_NAME)
                    .addValue("displayName", "Management automation service"), UUID.class);
        });
        if (accountId == null) {
            throw new IllegalStateException("unable to resolve tenant automation account");
        }
        return accountId;
    }
}
