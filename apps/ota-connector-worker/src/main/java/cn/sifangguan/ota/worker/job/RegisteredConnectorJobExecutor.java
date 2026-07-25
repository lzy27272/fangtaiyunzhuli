package cn.sifangguan.ota.worker.job;

import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractApprovalException;
import cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractExecutionPreflight;
import cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractDriftException;
import cn.sifangguan.ota.worker.sprint2.contract.RuntimeConnectorContractGuard;
import cn.sifangguan.ota.worker.sprint2.contract.RuntimeConnectorContractExecutionGuard;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidationException;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidator;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;

@Component
public final class RegisteredConnectorJobExecutor implements ConnectorJobExecutionPort {
    private final SourceConnectorRegistry registry;
    private final Clock clock;
    private final CollectionResultSafetyGate resultSafetyGate;
    private final ConnectorContractExecutionPreflight contractExecutionPreflight;

    public RegisteredConnectorJobExecutor(
            SourceConnectorRegistry registry,
            @Qualifier("utcClock") Clock clock) {
        this(
                registry,
                clock,
                new CollectionResultSafetyGate(
                        registry,
                        new CollectionResultValidator(),
                        new RuntimeConnectorContractGuard(registry)),
                RuntimeConnectorContractExecutionGuard
                        .failClosedWithoutPersistentReader());
    }

    RegisteredConnectorJobExecutor(
            SourceConnectorRegistry registry,
            @Qualifier("utcClock") Clock clock,
            ConnectorContractExecutionPreflight contractExecutionPreflight) {
        this(
                registry,
                clock,
                new CollectionResultSafetyGate(
                        registry,
                        new CollectionResultValidator(),
                        new RuntimeConnectorContractGuard(registry)),
                contractExecutionPreflight);
    }

    @Autowired
    public RegisteredConnectorJobExecutor(
            SourceConnectorRegistry registry,
            @Qualifier("utcClock") Clock clock,
            CollectionResultSafetyGate resultSafetyGate,
            ConnectorContractExecutionPreflight
                    contractExecutionPreflight) {
        this.registry = Objects.requireNonNull(registry, "registry");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.resultSafetyGate = Objects.requireNonNull(resultSafetyGate, "resultSafetyGate");
        this.contractExecutionPreflight = Objects.requireNonNull(
                contractExecutionPreflight,
                "contractExecutionPreflight");
    }

    @Override
    public JobExecutionOutcome execute(ClaimedCollectionJob job) {
        Objects.requireNonNull(job, "job");
        var startedAt = Instant.now(clock);
        if (!job.leaseExpiresAt().isAfter(startedAt)) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.LEASE_EXPIRED,
                    "JOB_LEASE_EXPIRED",
                    startedAt);
        }

        var connector = registry.find(job.connectorCode()).orElse(null);
        if (connector == null) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.CONNECTOR_NOT_REGISTERED,
                    "CONNECTOR_NOT_REGISTERED",
                    Instant.now(clock));
        }
        var descriptor = connector.descriptor();
        if (!descriptor.streams().contains(job.request().stream())) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.UNSUPPORTED_STREAM,
                    "CONNECTOR_STREAM_UNSUPPORTED",
                    Instant.now(clock));
        }

        try {
            contractExecutionPreflight.verifyBeforeExecution(job, connector);
            var result = connector.collect(job.request());
            var finishedAt = Instant.now(clock);
            var validated = resultSafetyGate.validate(
                    job.connectorCode(),
                    job.request(),
                    result,
                    finishedAt);
            return JobExecutionOutcome.result(validated, finishedAt);
        } catch (CollectionResultValidationException invalidResult) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.EXECUTION_FAILED,
                    invalidResult.reasonCode(),
                    Instant.now(clock));
        } catch (ConnectorContractApprovalException approvalFailure) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.EXECUTION_FAILED,
                    approvalFailure.reasonCode(),
                    Instant.now(clock));
        } catch (ConnectorContractDriftException drift) {
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.EXECUTION_FAILED,
                    drift.reasonCode(),
                    Instant.now(clock));
        } catch (RuntimeException ignored) {
            // Never propagate connector messages: vendor exceptions may contain credentials or PII.
            return JobExecutionOutcome.failure(
                    JobExecutionStatus.EXECUTION_FAILED,
                    "CONNECTOR_UNHANDLED_FAILURE",
                    Instant.now(clock));
        }
    }
}
