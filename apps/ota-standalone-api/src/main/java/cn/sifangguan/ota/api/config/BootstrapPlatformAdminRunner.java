package cn.sifangguan.ota.api.config;

import cn.sifangguan.ota.api.auth.application.BootstrapPlatformAdminService;
import cn.sifangguan.ota.api.auth.port.SecretValueProvider;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;

import java.util.Arrays;
import java.util.UUID;

public final class BootstrapPlatformAdminRunner implements ApplicationRunner, Ordered {
    public static final String REQUIRED_CONFIRMATION = "CREATE_FIRST_PLATFORM_ADMIN_ONCE";

    private final OtaSecurityProperties properties;
    private final SecretValueProvider secrets;
    private final BootstrapPlatformAdminService bootstrap;

    public BootstrapPlatformAdminRunner(
            OtaSecurityProperties properties,
            SecretValueProvider secrets,
            BootstrapPlatformAdminService bootstrap
    ) {
        this.properties = properties;
        this.secrets = secrets;
        this.bootstrap = bootstrap;
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE + 100;
    }

    @Override
    public void run(ApplicationArguments args) {
        OtaSecurityProperties.Bootstrap command = properties.getBootstrap();
        if (!command.isEnabled()) {
            return;
        }
        if (!REQUIRED_CONFIRMATION.equals(command.getConfirmation())) {
            throw new IllegalStateException("Bootstrap confirmation is missing or invalid");
        }
        char[] password = secrets.resolve(command.getPasswordSecretRef());
        try {
            bootstrap.bootstrap(
                    command.getUsername(), command.getDisplayName(), password,
                    "bootstrap-" + UUID.randomUUID());
        } finally {
            Arrays.fill(password, '\0');
        }
    }
}
