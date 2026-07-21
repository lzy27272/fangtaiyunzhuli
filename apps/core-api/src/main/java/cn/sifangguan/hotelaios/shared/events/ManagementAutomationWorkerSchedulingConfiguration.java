package cn.sifangguan.hotelaios.shared.events;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(
        prefix = "app.automation.worker",
        name = "enabled",
        havingValue = "true"
)
public class ManagementAutomationWorkerSchedulingConfiguration {
}
