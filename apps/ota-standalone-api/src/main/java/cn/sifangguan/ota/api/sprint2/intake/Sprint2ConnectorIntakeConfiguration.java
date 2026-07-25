package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Clock;

@Configuration
public class Sprint2ConnectorIntakeConfiguration {
    @Bean
    ConnectorIntakeTemplateDirectory connectorIntakeTemplateDirectory() {
        return new ConnectorIntakeTemplateDirectory();
    }

    @Bean
    @ConditionalOnMissingBean(ConnectorIntakePort.class)
    ConnectorIntakePort jdbcConnectorIntakePort(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper
    ) {
        return new JdbcConnectorIntakePort(jdbc, objectMapper);
    }

    @Bean
    @ConditionalOnMissingBean(ConnectorAdmissionReadinessPort.class)
    ConnectorAdmissionReadinessPort jdbcConnectorAdmissionReadinessPort(
            JdbcTemplate jdbc
    ) {
        return new JdbcConnectorAdmissionReadinessPort(jdbc);
    }

    @Bean
    ConnectorIntakeService connectorIntakeService(
            ConnectorIntakeTemplateDirectory templates,
            ConnectorIntakePort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock
    ) {
        return new ConnectorIntakeService(templates, port, tenants, audit, clock);
    }

    @Bean
    ConnectorAdmissionReadinessService connectorAdmissionReadinessService(
            ConnectorAdmissionReadinessPort port,
            TenantContextExecutor tenants
    ) {
        return new ConnectorAdmissionReadinessService(port, tenants);
    }
}
