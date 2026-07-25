package cn.sifangguan.ota.worker.simulation.config;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration(proxyBeanMethods = false)
@Profile("sprint1-simulation & (prod | production)")
@ConditionalOnProperty(
        prefix = "ota.sprint1.simulation",
        name = "enabled",
        havingValue = "true")
public class SimulationProductionRefusalConfiguration {
    @Bean
    Object rejectSprint1SimulationInProduction() {
        throw new IllegalStateException(
                "SPRINT1_SIMULATION_FORBIDDEN_IN_PRODUCTION");
    }
}
