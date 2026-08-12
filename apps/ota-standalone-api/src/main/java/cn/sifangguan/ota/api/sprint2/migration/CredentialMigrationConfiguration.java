package cn.sifangguan.ota.api.sprint2.migration;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Clock;

@Configuration
public class CredentialMigrationConfiguration {
    @Bean
    @ConditionalOnMissingBean(CredentialMigrationPort.class)
    CredentialMigrationPort jdbcCredentialMigrationPort(JdbcTemplate jdbc) {
        return new JdbcCredentialMigrationPort(jdbc);
    }

    @Bean
    CredentialMigrationService credentialMigrationService(
            CredentialMigrationPort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock
    ) {
        return new CredentialMigrationService(port, tenants, audit, clock);
    }
}
