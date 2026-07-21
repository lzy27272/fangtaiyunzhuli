package cn.sifangguan.hotelaios;

import cn.sifangguan.hotelaios.shared.security.RequiredSecretPreflight;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class HotelAiOsApplication {
    public static void main(String[] args) {
        RequiredSecretPreflight.validate(System.getenv());
        SpringApplication.run(HotelAiOsApplication.class, args);
    }
}
