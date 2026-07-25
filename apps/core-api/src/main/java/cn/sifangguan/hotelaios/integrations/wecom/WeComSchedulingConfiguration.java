package cn.sifangguan.hotelaios.integrations.wecom;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.EnableAsync;

@Configuration
@EnableScheduling
@EnableAsync
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComSchedulingConfiguration { }
