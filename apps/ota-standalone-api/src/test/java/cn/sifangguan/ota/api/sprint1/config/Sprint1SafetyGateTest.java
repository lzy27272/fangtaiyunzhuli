package cn.sifangguan.ota.api.sprint1.config;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class Sprint1SafetyGateTest {
    @Test
    void productionRejectsSimulationAtStartupAndAtTriggerTime() {
        Sprint1SafetyProperties properties = new Sprint1SafetyProperties();
        properties.setSimulationEnabled(true);
        MockEnvironment environment = new MockEnvironment();
        environment.setActiveProfiles("production");
        Sprint1SafetyGate gate = new Sprint1SafetyGate(properties, environment);

        assertThatThrownBy(() -> gate.run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Production");
        assertThatThrownBy(gate::requireSimulationTriggerAllowed)
                .isInstanceOf(SimulationUnavailableException.class)
                .hasMessageContaining("production");
    }

    @Test
    void localSimulationRequiresExplicitOptInAndNeverAllowsOutboundHttp() {
        Sprint1SafetyProperties disabled = new Sprint1SafetyProperties();
        Sprint1SafetyGate disabledGate = new Sprint1SafetyGate(disabled, new MockEnvironment());
        assertThatThrownBy(disabledGate::requireSimulationTriggerAllowed)
                .isInstanceOf(SimulationUnavailableException.class);

        Sprint1SafetyProperties safe = new Sprint1SafetyProperties();
        safe.setSimulationEnabled(true);
        Sprint1SafetyGate safeGate = new Sprint1SafetyGate(safe, new MockEnvironment());
        assertThatCode(safeGate::requireSimulationTriggerAllowed).doesNotThrowAnyException();

        safe.setOutboundHttpEnabled(true);
        assertThatThrownBy(() -> safeGate.run(null))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("outbound HTTP");
    }
}
