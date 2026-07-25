package cn.sifangguan.ota.worker.simulation.config;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.OtaConnectorWorkerApplication;
import cn.sifangguan.ota.worker.filefixture.FileFixtureConnector;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class SimulationProfileGuardTest {
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(OtaConnectorWorkerApplication.class);

    @Test
    void defaultContextRegistersNoSimulationCapability() {
        contextRunner.run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context).doesNotHaveBean(DeterministicSimulationPipeline.class);
            assertThat(context).hasSingleBean(SourceConnector.class);
            assertThat(context).hasSingleBean(FileFixtureConnector.class);
        });
    }

    @Test
    void propertyWithoutProfileDoesNotEnableSimulation() {
        contextRunner
                .withPropertyValues("ota.sprint1.simulation.enabled=true")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(DeterministicSimulationPipeline.class);
                    assertThat(context).hasSingleBean(SourceConnector.class);
                    assertThat(context).hasSingleBean(FileFixtureConnector.class);
                });
    }

    @Test
    void profileWithoutExplicitPropertyDoesNotEnableSimulation() {
        contextRunner
                .withPropertyValues("spring.profiles.active=sprint1-simulation")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).doesNotHaveBean(DeterministicSimulationPipeline.class);
                    assertThat(context).hasSingleBean(SourceConnector.class);
                    assertThat(context).hasSingleBean(FileFixtureConnector.class);
                });
    }

    @Test
    void profileAndPropertyRegisterThreeSimulationConnectorsAndFileFixture() {
        contextRunner
                .withPropertyValues(
                        "spring.profiles.active=sprint1-simulation",
                        "ota.sprint1.simulation.enabled=true",
                        "ota.sprint1.simulation.persistence-enabled=false")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context).hasSingleBean(DeterministicSimulationPipeline.class);
                    assertThat(context.getBeansOfType(SourceConnector.class)).hasSize(4);
                    assertThat(context.getBeansOfType(SourceConnector.class).values())
                            .extracting(connector -> connector.descriptor().connectorCode())
                            .containsExactlyInAnyOrder(
                                    "MOCK_PMS",
                                    "MOCK_CTRIP",
                                    "MOCK_MEITUAN",
                                    "FILE_FIXTURE");
                });
    }

    @Test
    void productionProfileActivelyRefusesSimulation() {
        contextRunner
                .withPropertyValues(
                        "spring.profiles.active=sprint1-simulation,production",
                        "ota.sprint1.simulation.enabled=true",
                        "ota.sprint1.simulation.persistence-enabled=false")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("SPRINT1_SIMULATION_FORBIDDEN_IN_PRODUCTION");
                });
    }
}
