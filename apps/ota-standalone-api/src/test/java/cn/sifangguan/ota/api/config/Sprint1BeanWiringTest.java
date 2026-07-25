package cn.sifangguan.ota.api.config;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.sprint1.adapter.JdbcSprint1ControlPlanePort;
import cn.sifangguan.ota.api.sprint1.config.Sprint1SafetyProperties;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.time.Clock;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class Sprint1BeanWiringTest {
    @Test
    void constructsCompleteSprint1ControlPlaneGraph() {
        ApplicationBeansConfiguration configuration = new ApplicationBeansConfiguration();
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        Clock clock = Clock.systemUTC();
        JdbcSprint1ControlPlanePort port = configuration.sprint1ControlPlanePort(
                jdbc, new ObjectMapper(), clock);
        TenantContextExecutor tenantContext = mock(TenantContextExecutor.class);
        AuditPort audit = mock(AuditPort.class);
        Sprint1SafetyProperties properties = new Sprint1SafetyProperties();
        var safety = configuration.sprint1SafetyGate(properties, new MockEnvironment());
        var privileged = configuration.privilegedTenantCommandExecutor(
                tenantContext, port, audit, clock);
        var crossTenant = configuration.crossTenantReadExecutor(
                port, tenantContext, audit, clock);

        assertThat(configuration.connectorAdapterDirectory()).isNotNull();
        assertThat(port).isNotNull();
        assertThat(safety).isNotNull();
        assertThat(privileged).isNotNull();
        assertThat(crossTenant).isNotNull();
        assertThat(configuration.sprint1ControlPlaneService(
                port, tenantContext, privileged, crossTenant, safety)).isNotNull();
    }
}
