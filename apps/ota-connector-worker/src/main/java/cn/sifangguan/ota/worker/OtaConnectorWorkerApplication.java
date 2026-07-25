package cn.sifangguan.ota.worker;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.context.annotation.Bean;

import java.time.Clock;

@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)
public class OtaConnectorWorkerApplication {
    public static void main(String[] args) {
        SpringApplication.run(OtaConnectorWorkerApplication.class, args);
    }

    @Bean
    Clock utcClock() {
        return Clock.systemUTC();
    }
}
