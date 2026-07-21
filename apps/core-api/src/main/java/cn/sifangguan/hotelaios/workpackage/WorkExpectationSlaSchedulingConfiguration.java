package cn.sifangguan.hotelaios.workpackage;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(
        prefix = "app.work-expectation.sla",
        name = "scheduler-enabled",
        havingValue = "true"
)
public class WorkExpectationSlaSchedulingConfiguration {
}
