package cn.sifangguan.hotelaios.shared.db;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class TenantDatabaseContext {
    private final JdbcTemplate jdbcTemplate;
    private final boolean rlsEnabled;

    public TenantDatabaseContext(
            JdbcTemplate jdbcTemplate,
            @Value("${app.database.rls-enabled:true}") boolean rlsEnabled
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.rlsEnabled = rlsEnabled;
    }

    public void apply(UUID tenantId) {
        if (rlsEnabled) {
            jdbcTemplate.queryForObject(
                    "select set_config('app.tenant_id', ?, true)",
                    String.class,
                    tenantId.toString()
            );
        }
    }
}

