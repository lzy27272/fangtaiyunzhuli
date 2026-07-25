package cn.sifangguan.ota.api;

import cn.sifangguan.ota.api.config.OtaSecurityProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;

@SpringBootApplication
@EnableConfigurationProperties(OtaSecurityProperties.class)
public class OtaStandaloneApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(OtaStandaloneApiApplication.class, args);
    }
}
