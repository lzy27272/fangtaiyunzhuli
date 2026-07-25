package cn.sifangguan.ota.worker.sprint2.config;

import cn.sifangguan.ota.worker.OtaConnectorWorkerApplication;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import static org.assertj.core.api.Assertions.assertThat;

class Sprint2OfflineRuntimeGateTest {
    private final ApplicationContextRunner contextRunner = new ApplicationContextRunner()
            .withUserConfiguration(OtaConnectorWorkerApplication.class);

    @Test
    void defaultAndPropertyAloneRemainOfflineAndStart() {
        contextRunner.run(context -> assertThat(context).hasNotFailed());
        contextRunner
                .withPropertyValues("ota.sprint2.real.enabled=true")
                .run(context -> assertThat(context).hasNotFailed());
    }

    @Test
    void realProfileWithoutSwitchFailsClosed() {
        contextRunner
                .withPropertyValues("spring.profiles.active=sprint2-real")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("SPRINT2_REAL_CONNECTORS_DISABLED");
                });
    }

    @Test
    void realProfileWithSwitchStillRefusesAbsentExternalRuntime() {
        contextRunner
                .withPropertyValues(
                        "spring.profiles.active=sprint2-real",
                        "ota.sprint2.real.enabled=true")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage(
                                    "SPRINT2A_EXTERNAL_SECRETSTORE_EGRESS_NOT_IMPLEMENTED");
                });
    }

    @Test
    void realAndSimulationProfilesCannotCoexist() {
        contextRunner
                .withPropertyValues(
                        "spring.profiles.active=sprint1-simulation,sprint2-real",
                        "ota.sprint2.real.enabled=true")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasRootCauseMessage("SPRINT2_REAL_SIMULATION_PROFILE_CONFLICT");
                });
    }
}
