package cn.sifangguan.ota.worker.simulation.config;

import cn.sifangguan.ota.worker.job.CollectionJobPoller;
import cn.sifangguan.ota.worker.job.ConnectorJobExecutionPort;
import cn.sifangguan.ota.worker.job.JdbcCollectionJobRepository;
import cn.sifangguan.ota.worker.job.WorkerIdentity;
import cn.sifangguan.ota.worker.sprint2.contract.ApprovedConnectorContractBaselineReader;
import cn.sifangguan.ota.worker.sprint2.contract.JdbcApprovedConnectorContractBaselineReader;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Clock;

/**
 * Adds the ordinary COLLECTION poller to the same fail-closed Sprint 1 JDBC
 * runtime used by the deterministic simulation pipeline.
 */
@Configuration(proxyBeanMethods = false)
@Profile("sprint1-simulation & !prod & !production")
@ConditionalOnProperty(
        prefix = "ota.sprint1.simulation",
        name = {"enabled", "persistence-enabled"},
        havingValue = "true")
public class Sprint1CollectionJdbcConfiguration {
    @Bean
    ApprovedConnectorContractBaselineReader
            approvedConnectorContractBaselineReader(
                    @Qualifier("sprint1SimulationJdbcTemplate")
                    JdbcTemplate jdbc,
                    @Qualifier("sprint1SimulationTransactionTemplate")
                    TransactionTemplate transactions) {
        return new JdbcApprovedConnectorContractBaselineReader(
                jdbc,
                transactions);
    }

    @Bean
    JdbcCollectionJobRepository jdbcCollectionJobRepository(
            @Qualifier("sprint1SimulationJdbcTemplate") JdbcTemplate jdbc,
            @Qualifier("sprint1SimulationTransactionTemplate")
            TransactionTemplate transactions,
            ObjectMapper objectMapper,
            CollectionResultSafetyGate resultSafetyGate) {
        return new JdbcCollectionJobRepository(
                jdbc, transactions, objectMapper, resultSafetyGate);
    }

    @Bean
    CollectionJobPoller collectionJobPoller(
            JdbcCollectionJobRepository repository,
            ConnectorJobExecutionPort executor,
            @Value("${ota.sprint1.simulation.worker-service-principal-id}")
            String workerServicePrincipalId,
            @Qualifier("sprint1SimulationJobClock") Clock clock) {
        return new CollectionJobPoller(
                repository,
                repository,
                executor,
                new WorkerIdentity(workerServicePrincipalId),
                clock);
    }
}
