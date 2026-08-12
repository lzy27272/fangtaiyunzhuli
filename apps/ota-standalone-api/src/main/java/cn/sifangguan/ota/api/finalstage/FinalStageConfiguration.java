package cn.sifangguan.ota.api.finalstage;

import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import static cn.sifangguan.ota.api.finalstage.ExternalCapabilityPorts.*;

@Configuration
public class FinalStageConfiguration {
    @Bean
    FinalStagePolicyEngine finalStagePolicyEngine() {
        return new FinalStagePolicyEngine();
    }

    @Bean
    @ConditionalOnMissingBean(ModelGateway.class)
    ModelGateway disabledModelGateway() {
        return new DisabledModelGateway();
    }

    @Bean
    @ConditionalOnMissingBean(StandardRetailPriceWriter.class)
    StandardRetailPriceWriter disabledStandardRetailPriceWriter() {
        return new DisabledStandardRetailPriceWriter();
    }
}
