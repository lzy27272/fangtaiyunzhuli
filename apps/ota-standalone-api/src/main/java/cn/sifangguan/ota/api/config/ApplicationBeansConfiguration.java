package cn.sifangguan.ota.api.config;

import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.audit.JdbcAuditPort;
import cn.sifangguan.ota.api.auth.adapter.EnvironmentSecretValueProvider;
import cn.sifangguan.ota.api.auth.adapter.JdbcAccountRepository;
import cn.sifangguan.ota.api.auth.adapter.JdbcAuthSessionRepository;
import cn.sifangguan.ota.api.auth.adapter.BoundedLoginAttemptLimiter;
import cn.sifangguan.ota.api.auth.application.AccessTokenService;
import cn.sifangguan.ota.api.auth.application.Argon2idPasswordHasher;
import cn.sifangguan.ota.api.auth.application.AuthenticationService;
import cn.sifangguan.ota.api.auth.application.BootstrapPlatformAdminService;
import cn.sifangguan.ota.api.auth.application.HmacAccessTokenService;
import cn.sifangguan.ota.api.auth.application.PasswordHasher;
import cn.sifangguan.ota.api.auth.application.RefreshTokenCodec;
import cn.sifangguan.ota.api.auth.port.AccountRepository;
import cn.sifangguan.ota.api.auth.port.AuthSessionRepository;
import cn.sifangguan.ota.api.auth.port.SecretValueProvider;
import cn.sifangguan.ota.api.auth.port.LoginAttemptLimiter;
import cn.sifangguan.ota.api.tenancy.PostgresRlsTenantContextExecutor;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import cn.sifangguan.ota.api.tenancy.CrossTenantReadExecutor;
import cn.sifangguan.ota.api.tenancy.PrivilegedTenantCommandExecutor;
import cn.sifangguan.ota.api.health.SecurityMaterialHealthIndicator;
import cn.sifangguan.ota.api.sprint1.adapter.JdbcSprint1ControlPlanePort;
import cn.sifangguan.ota.api.sprint1.application.Sprint1ControlPlaneService;
import cn.sifangguan.ota.api.sprint1.catalog.ConnectorAdapterDirectory;
import cn.sifangguan.ota.api.sprint1.config.Sprint1SafetyGate;
import cn.sifangguan.ota.api.sprint1.config.Sprint1SafetyProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.jdbc.DataSourceProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;

import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

@Configuration
@EnableConfigurationProperties(Sprint1SafetyProperties.class)
public class ApplicationBeansConfiguration {
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    @Bean
    SecureRandom secureRandom() {
        return new SecureRandom();
    }

    @Bean
    SecretValueProvider secretValueProvider() {
        return new EnvironmentSecretValueProvider();
    }

    @Bean
    PasswordHasher passwordHasher() {
        return new Argon2idPasswordHasher();
    }

    @Bean
    RefreshTokenCodec refreshTokenCodec(SecureRandom secureRandom) {
        return new RefreshTokenCodec(secureRandom);
    }

    @Bean
    LoginAttemptLimiter loginAttemptLimiter() {
        return new BoundedLoginAttemptLimiter(20_000, 10, 30, Duration.ofMinutes(1));
    }

    @Bean
    AccountRepository accountRepository(JdbcTemplate jdbc, OtaSecurityProperties properties) {
        return new JdbcAccountRepository(
                jdbc, properties.getLogin().getMaxFailures(), properties.getLogin().getLockDuration());
    }

    @Bean
    AuthSessionRepository authSessionRepository(JdbcTemplate jdbc) {
        return new JdbcAuthSessionRepository(jdbc);
    }

    @Bean
    AuditPort auditPort(JdbcTemplate jdbc) {
        return new JdbcAuditPort(jdbc);
    }

    @Bean
    TenantContextExecutor tenantContextExecutor(
            JdbcTemplate jdbc,
            PlatformTransactionManager transactionManager
    ) {
        return new PostgresRlsTenantContextExecutor(jdbc, transactionManager);
    }

    @Bean
    AccessTokenService accessTokenService(
            ObjectMapper objectMapper,
            Clock clock,
            SecretValueProvider secrets,
            OtaSecurityProperties properties
    ) {
        SigningKeyRotationPolicy.validate(properties, clock.instant());
        Map<String, HmacAccessTokenService.SigningKey> keys = new HashMap<>();
        byte[] current = resolveBase64Key(secrets, properties.getCurrentSigningSecretRef());
        try {
            keys.put(properties.getCurrentSigningKeyId(),
                    new HmacAccessTokenService.SigningKey(current, Instant.MAX));
        } finally {
            Arrays.fill(current, (byte) 0);
        }
        if (!properties.getPreviousSigningSecretRef().isBlank()) {
            byte[] previous = resolveBase64Key(secrets, properties.getPreviousSigningSecretRef());
            try {
                keys.put(properties.getPreviousSigningKeyId(),
                        new HmacAccessTokenService.SigningKey(
                                previous, properties.getPreviousSigningKeyValidUntil()));
            } finally {
                Arrays.fill(previous, (byte) 0);
            }
        }
        return new HmacAccessTokenService(
                objectMapper, clock, properties.getIssuer(), properties.getAccessTtl(),
                properties.getCurrentSigningKeyId(), keys);
    }

    @Bean
    AuthenticationService authenticationService(
            AccountRepository accounts,
            AuthSessionRepository sessions,
            AuditPort audit,
            PasswordHasher passwordHasher,
            AccessTokenService accessTokens,
            RefreshTokenCodec refreshTokens,
            LoginAttemptLimiter loginLimiter,
            Clock clock,
            OtaSecurityProperties properties
    ) {
        return new AuthenticationService(
                accounts, sessions, audit, passwordHasher, accessTokens, refreshTokens, loginLimiter, clock,
                properties.getRefreshTtl());
    }

    @Bean
    BootstrapPlatformAdminService bootstrapPlatformAdminService(
            AccountRepository accounts,
            PasswordHasher passwordHasher,
            AuditPort audit,
            Clock clock
    ) {
        return new BootstrapPlatformAdminService(accounts, passwordHasher, audit, clock);
    }

    @Bean
    BootstrapPlatformAdminRunner bootstrapPlatformAdminRunner(
            OtaSecurityProperties properties,
            SecretValueProvider secrets,
            BootstrapPlatformAdminService bootstrap
    ) {
        return new BootstrapPlatformAdminRunner(properties, secrets, bootstrap);
    }

    @Bean
    ProductionSafetyValidator productionSafetyValidator(
            DataSourceProperties dataSource,
            OtaSecurityProperties properties,
            JdbcTemplate jdbc,
            @Value("${spring.flyway.enabled:false}") boolean flywayEnabledInApi,
            @Value("${ota.database.flyway-history-table:flyway.flyway_schema_history}")
            String flywayHistoryTable
    ) {
        return new ProductionSafetyValidator(
                dataSource, properties, jdbc, flywayEnabledInApi, flywayHistoryTable);
    }

    @Bean
    SecurityMaterialHealthIndicator securityMaterialHealthIndicator(AccessTokenService accessTokens) {
        return new SecurityMaterialHealthIndicator(accessTokens);
    }

    @Bean
    ConnectorAdapterDirectory connectorAdapterDirectory() {
        return new ConnectorAdapterDirectory();
    }

    @Bean
    JdbcSprint1ControlPlanePort sprint1ControlPlanePort(
            JdbcTemplate jdbc,
            ObjectMapper objectMapper,
            Clock clock
    ) {
        return new JdbcSprint1ControlPlanePort(jdbc, objectMapper, clock);
    }

    @Bean
    Sprint1SafetyGate sprint1SafetyGate(
            Sprint1SafetyProperties properties,
            Environment environment
    ) {
        return new Sprint1SafetyGate(properties, environment);
    }

    @Bean
    PrivilegedTenantCommandExecutor privilegedTenantCommandExecutor(
            TenantContextExecutor tenantContext,
            JdbcSprint1ControlPlanePort sprint1,
            AuditPort audit,
            Clock clock
    ) {
        return new PrivilegedTenantCommandExecutor(
                tenantContext, sprint1, sprint1, audit, clock);
    }

    @Bean
    CrossTenantReadExecutor crossTenantReadExecutor(
            JdbcSprint1ControlPlanePort sprint1,
            TenantContextExecutor tenantContext,
            AuditPort audit,
            Clock clock
    ) {
        return new CrossTenantReadExecutor(sprint1, tenantContext, audit, clock);
    }

    @Bean
    Sprint1ControlPlaneService sprint1ControlPlaneService(
            JdbcSprint1ControlPlanePort sprint1,
            TenantContextExecutor tenantContext,
            PrivilegedTenantCommandExecutor commands,
            CrossTenantReadExecutor crossTenantReads,
            Sprint1SafetyGate safety
    ) {
        return new Sprint1ControlPlaneService(
                sprint1, tenantContext, commands, crossTenantReads, safety);
    }

    private static byte[] resolveBase64Key(SecretValueProvider secrets, String reference) {
        char[] secret = secrets.resolve(reference);
        byte[] encoded = new byte[secret.length];
        try {
            for (int index = 0; index < secret.length; index++) {
                if (secret[index] > 127) {
                    throw new IllegalStateException("Signing secret must be base64 ASCII");
                }
                encoded[index] = (byte) secret[index];
            }
            return Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("Signing secret reference did not resolve to valid base64", exception);
        } finally {
            Arrays.fill(secret, '\0');
            Arrays.fill(encoded, (byte) 0);
        }
    }
}
