package cn.sifangguan.ota.worker.sprint2.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import java.util.Arrays;
import java.util.Set;

@Configuration(proxyBeanMethods = false)
public class Sprint2OfflineRuntimeGateConfiguration {
    @Bean
    Sprint2OfflineRuntimeGate sprint2OfflineRuntimeGate(Environment environment) {
        var gate = new Sprint2OfflineRuntimeGate();
        boolean realEnabled =
                environment.getProperty("ota.sprint2.real.enabled", Boolean.class, false);
        gate.assertStartupAllowed(Set.copyOf(Arrays.asList(environment.getActiveProfiles())), realEnabled);
        return gate;
    }
}
