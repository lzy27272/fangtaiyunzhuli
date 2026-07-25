package cn.sifangguan.ota.api.sprint1.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.env.Environment;

import java.util.Arrays;
import java.util.Locale;

/**
 * Sprint 1 is deliberately simulation-only. The API contains no outbound HTTP
 * sender, and this gate also rejects unsafe deployment configuration.
 */
public final class Sprint1SafetyGate implements ApplicationRunner, Ordered {
    private final Sprint1SafetyProperties properties;
    private final Environment environment;

    public Sprint1SafetyGate(Sprint1SafetyProperties properties, Environment environment) {
        this.properties = properties;
        this.environment = environment;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 10;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (properties.isOutboundHttpEnabled()) {
            throw new IllegalStateException(
                    "Sprint 1 forbids outbound HTTP delivery; outbox is preview-only");
        }
        if (isProduction() && properties.isSimulationEnabled()) {
            throw new IllegalStateException(
                    "Production profile must not enable Sprint 1 simulation");
        }
    }

    public void requireSimulationTriggerAllowed() {
        if (!properties.isSimulationEnabled()) {
            throw new SimulationUnavailableException("Sprint 1 simulation is disabled");
        }
        if (isProduction()) {
            throw new SimulationUnavailableException(
                    "Simulation triggers are forbidden in production");
        }
        if (properties.isOutboundHttpEnabled()) {
            throw new SimulationUnavailableException(
                    "Simulation cannot run while outbound HTTP is enabled");
        }
    }

    public boolean isSimulationMode() {
        return properties.isSimulationEnabled() && !isProduction();
    }

    private boolean isProduction() {
        return Arrays.stream(environment.getActiveProfiles())
                .map(value -> value.toLowerCase(Locale.ROOT))
                .anyMatch(value -> value.equals("prod") || value.equals("production"));
    }
}
