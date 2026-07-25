package cn.sifangguan.ota.worker.simulation.config;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

import java.time.Clock;
import java.time.ZoneOffset;

@Configuration(proxyBeanMethods = false)
@Profile("sprint1-simulation & !prod & !production")
@ConditionalOnProperty(
        prefix = "ota.sprint1.simulation",
        name = "enabled",
        havingValue = "true")
public class Sprint1SimulationConfiguration {
    @Bean("sprint1SimulationClock")
    Clock sprint1SimulationClock() {
        return Clock.fixed(BuiltInSimulationFixture.FIXED_NOW, ZoneOffset.UTC);
    }

    @Bean
    SourceConnector sprint1SimulationPmsConnector(
            @Qualifier("sprint1SimulationClock") Clock clock) {
        return new SimulationPmsConnector(clock);
    }

    @Bean
    SourceConnector sprint1SimulationCtripConnector(
            @Qualifier("sprint1SimulationClock") Clock clock) {
        return new SimulationCtripConnector(clock);
    }

    @Bean
    SourceConnector sprint1SimulationMeituanConnector(
            @Qualifier("sprint1SimulationClock") Clock clock) {
        return new SimulationMeituanConnector(clock);
    }

    @Bean
    DeterministicSimulationPipeline deterministicSimulationPipeline(
            SourceConnectorRegistry registry,
            @Qualifier("sprint1SimulationClock") Clock clock) {
        return new DeterministicSimulationPipeline(registry, clock);
    }
}
