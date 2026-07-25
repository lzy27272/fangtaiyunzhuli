package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.security.SecureRandom;
import java.time.Clock;

@Configuration
public class BrowserAuthorizationRehearsalConfiguration {
    @Bean
    @ConditionalOnMissingBean(BrowserAuthorizationRehearsalPort.class)
    BrowserAuthorizationRehearsalPort browserAuthorizationRehearsalPort(
            JdbcTemplate jdbc
    ) {
        return new JdbcBrowserAuthorizationRehearsalPort(jdbc);
    }

    @Bean
    OfflineRehearsalPolicyAdapter offlineRehearsalPolicyAdapter() {
        return new OfflineRehearsalPolicyAdapter();
    }

    @Bean
    BrowserAuthorizationRehearsalService browserAuthorizationRehearsalService(
            BrowserAuthorizationRehearsalPort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock,
            SecureRandom secureRandom,
            OfflineRehearsalPolicyAdapter offlinePolicy
    ) {
        return new BrowserAuthorizationRehearsalService(
                port,
                tenants,
                audit,
                clock,
                secureRandom,
                offlinePolicy);
    }
}
