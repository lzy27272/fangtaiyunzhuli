package cn.sifangguan.ota.worker.simulation.config;

import cn.sifangguan.ota.worker.simulation.persistence.JdbcSimulationJobRepository;
import cn.sifangguan.ota.worker.simulation.persistence.DynamicScheduleDispatcher;
import cn.sifangguan.ota.worker.simulation.persistence.DynamicSchedulePort;
import cn.sifangguan.ota.worker.simulation.persistence.JdbcDynamicSchedulePort;
import cn.sifangguan.ota.worker.simulation.persistence.SimulationDatabaseSafetyVerifier;
import cn.sifangguan.ota.worker.simulation.persistence.SimulationJobPoller;
import cn.sifangguan.ota.worker.simulation.persistence.SimulationJobRepository;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.time.Clock;
import java.util.Locale;
import java.util.UUID;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@Profile("sprint1-simulation & !prod & !production")
@ConditionalOnProperty(
        prefix = "ota.sprint1.simulation",
        name = {"enabled", "persistence-enabled"},
        havingValue = "true")
public class Sprint1SimulationJdbcConfiguration {
    @Bean("sprint1SimulationJobClock")
    Clock sprint1SimulationJobClock() {
        return Clock.systemUTC();
    }

    @Bean(destroyMethod = "close")
    HikariDataSource sprint1SimulationDataSource(
            @Value("${ota.sprint1.simulation.jdbc-url}") String jdbcUrl,
            @Value("${ota.sprint1.simulation.database-username}") String username,
            @Value("${ota.sprint1.simulation.database-password}") String password) {
        validateDatabaseSettings(jdbcUrl, username);
        var config = new HikariConfig();
        config.setPoolName("ota-sprint1-simulation");
        config.setJdbcUrl(jdbcUrl);
        config.setUsername(username);
        config.setPassword(password);
        config.setMaximumPoolSize(2);
        config.setMinimumIdle(0);
        config.setAutoCommit(true);
        config.setConnectionInitSql("SET row_security = on");
        return new HikariDataSource(config);
    }

    @Bean
    JdbcTemplate sprint1SimulationJdbcTemplate(
            @Qualifier("sprint1SimulationDataSource") DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    @Bean
    TransactionTemplate sprint1SimulationTransactionTemplate(
            @Qualifier("sprint1SimulationDataSource") DataSource dataSource) {
        return new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    @Bean
    SimulationJobRepository simulationJobRepository(
            @Qualifier("sprint1SimulationJdbcTemplate") JdbcTemplate jdbc,
            @Qualifier("sprint1SimulationTransactionTemplate") TransactionTemplate transactions,
            ObjectMapper objectMapper) {
        return new JdbcSimulationJobRepository(jdbc, transactions, objectMapper);
    }

    @Bean
    SimulationDatabaseSafetyVerifier simulationDatabaseSafetyVerifier(
            @Qualifier("sprint1SimulationJdbcTemplate") JdbcTemplate jdbc,
            @Value("${ota.sprint1.simulation.worker-service-principal-id}")
            String workerServicePrincipalId) {
        return new SimulationDatabaseSafetyVerifier(
                jdbc,
                UUID.fromString(workerServicePrincipalId));
    }

    @Bean
    DynamicSchedulePort dynamicSchedulePort(
            @Qualifier("sprint1SimulationJdbcTemplate") JdbcTemplate jdbc) {
        return new JdbcDynamicSchedulePort(jdbc);
    }

    @Bean
    DynamicScheduleDispatcher dynamicScheduleDispatcher(
            DynamicSchedulePort port,
            @Value("${ota.sprint1.simulation.worker-service-principal-id}")
            String workerServicePrincipalId,
            @Value("${ota.sprint1.simulation.dispatch-batch-size:100}")
            int batchSize,
            @Qualifier("sprint1SimulationJobClock") Clock clock) {
        return new DynamicScheduleDispatcher(
                port,
                UUID.fromString(workerServicePrincipalId),
                clock,
                batchSize);
    }

    @Bean
    ApplicationRunner verifySimulationDatabaseBeforePolling(
            SimulationDatabaseSafetyVerifier verifier) {
        return ignored -> verifier.verify();
    }

    @Bean
    SimulationJobPoller simulationJobPoller(
            SimulationJobRepository repository,
            DeterministicSimulationPipeline pipeline,
            @Value("${ota.sprint1.simulation.worker-service-principal-id}")
            String workerServicePrincipalId,
            @Qualifier("sprint1SimulationJobClock") Clock clock) {
        return new SimulationJobPoller(
                repository,
                pipeline,
                UUID.fromString(workerServicePrincipalId),
                clock);
    }

    private static void validateDatabaseSettings(String jdbcUrl, String username) {
        if (jdbcUrl == null || !jdbcUrl.startsWith("jdbc:postgresql://")) {
            throw new IllegalStateException("SIMULATION_POSTGRESQL_JDBC_URL_REQUIRED");
        }
        if (username == null || username.isBlank()) {
            throw new IllegalStateException("SIMULATION_DATABASE_USERNAME_REQUIRED");
        }
        var normalized = username.toLowerCase(Locale.ROOT);
        if (normalized.equals("postgres")
                || normalized.contains("migration")
                || normalized.contains("owner")
                || normalized.contains("superuser")) {
            throw new IllegalStateException("SIMULATION_DATABASE_ROLE_NOT_RUNTIME_SAFE");
        }
    }
}
