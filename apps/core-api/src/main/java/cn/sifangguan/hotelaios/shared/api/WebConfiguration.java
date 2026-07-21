package cn.sifangguan.hotelaios.shared.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
public class WebConfiguration implements WebMvcConfigurer {
    private final String[] allowedOrigins;

    public WebConfiguration(@Value("${app.web.allowed-origins:http://localhost:5173}") String allowedOrigins) {
        this.allowedOrigins = allowedOrigins.split(",");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE")
                .allowedHeaders(
                        "Authorization", "Content-Type", "Idempotency-Key", "If-Match",
                        "X-Tenant-Id", "X-Actor-Id", "X-Role-Code", "X-Org-Scope", "X-Correlation-Id"
                )
                .allowCredentials(true)
                .exposedHeaders("X-Correlation-Id");
    }
}
