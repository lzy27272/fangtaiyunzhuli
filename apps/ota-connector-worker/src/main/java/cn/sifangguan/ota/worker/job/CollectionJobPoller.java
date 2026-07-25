package cn.sifangguan.ota.worker.job;

import org.springframework.scheduling.annotation.Scheduled;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * One-claim-at-a-time collection loop. Connector exceptions are already
 * sanitized by RegisteredConnectorJobExecutor before persistence.
 */
public final class CollectionJobPoller implements AutoCloseable {
    private static final Duration DEFAULT_HEARTBEAT_INTERVAL =
            Duration.ofSeconds(30);
    private static final Duration DEFAULT_LEASE_EXTENSION =
            Duration.ofMinutes(10);

    private final CollectionJobClaimPort claims;
    private final CollectionJobLeasePort leases;
    private final ConnectorJobExecutionPort executor;
    private final WorkerIdentity worker;
    private final Clock clock;
    private final ExecutorService executionPool;
    private final Duration heartbeatInterval;
    private final Duration leaseExtension;
    private final AtomicBoolean polling = new AtomicBoolean();

    public CollectionJobPoller(
            CollectionJobClaimPort claims,
            CollectionJobLeasePort leases,
            ConnectorJobExecutionPort executor,
            WorkerIdentity worker,
            Clock clock) {
        this(
                claims,
                leases,
                executor,
                worker,
                clock,
                Executors.newVirtualThreadPerTaskExecutor(),
                DEFAULT_HEARTBEAT_INTERVAL,
                DEFAULT_LEASE_EXTENSION);
    }

    CollectionJobPoller(
            CollectionJobClaimPort claims,
            CollectionJobLeasePort leases,
            ConnectorJobExecutionPort executor,
            WorkerIdentity worker,
            Clock clock,
            ExecutorService executionPool,
            Duration heartbeatInterval,
            Duration leaseExtension) {
        this.claims = Objects.requireNonNull(claims, "claims");
        this.leases = Objects.requireNonNull(leases, "leases");
        this.executor = Objects.requireNonNull(executor, "executor");
        this.worker = Objects.requireNonNull(worker, "worker");
        this.clock = Objects.requireNonNull(clock, "clock");
        this.executionPool = Objects.requireNonNull(
                executionPool,
                "executionPool");
        this.heartbeatInterval = requirePositive(
                heartbeatInterval,
                "heartbeatInterval");
        this.leaseExtension = requirePositive(
                leaseExtension,
                "leaseExtension");
    }

    @Scheduled(
            fixedDelayString =
                    "${ota.sprint1.simulation.collection-poll-delay:5s}",
            initialDelayString =
                    "${ota.sprint1.simulation.collection-poll-delay:5s}")
    public void pollOnce() {
        if (!polling.compareAndSet(false, true)) {
            return;
        }
        try {
            claims.claimNext(worker, Instant.now(clock))
                    .ifPresent(this::execute);
        } finally {
            polling.set(false);
        }
    }

    private void execute(ClaimedCollectionJob job) {
        Future<JobExecutionOutcome> execution =
                executionPool.submit(() -> executor.execute(job));
        var outcome = awaitWithHeartbeat(job, execution);
        if (outcome.isEmpty()) {
            return;
        }

        var recordedAt = Instant.now(clock);
        if (!leases.renew(
                job,
                worker,
                recordedAt,
                recordedAt.plus(leaseExtension))) {
            execution.cancel(true);
            return;
        }
        leases.record(job, worker, outcome.orElseThrow(), recordedAt);
    }

    private Optional<JobExecutionOutcome> awaitWithHeartbeat(
            ClaimedCollectionJob job,
            Future<JobExecutionOutcome> execution) {
        long timeoutNanos = positiveNanos(job.request().timeout());
        long deadlineNanos = saturatingAdd(System.nanoTime(), timeoutNanos);
        long heartbeatNanos = positiveNanos(heartbeatInterval);

        while (true) {
            long remainingNanos = deadlineNanos - System.nanoTime();
            if (remainingNanos <= 0) {
                execution.cancel(true);
                return Optional.of(timeoutOutcome());
            }
            long waitNanos = Math.min(remainingNanos, heartbeatNanos);
            try {
                return Optional.of(execution.get(
                        waitNanos,
                        TimeUnit.NANOSECONDS));
            } catch (TimeoutException timedWaitElapsed) {
                if (deadlineNanos - System.nanoTime() <= 0) {
                    execution.cancel(true);
                    return Optional.of(timeoutOutcome());
                }
                var heartbeatAt = Instant.now(clock);
                boolean renewed;
                try {
                    renewed = leases.renew(
                            job,
                            worker,
                            heartbeatAt,
                            heartbeatAt.plus(leaseExtension));
                } catch (RuntimeException leaseFailure) {
                    execution.cancel(true);
                    throw leaseFailure;
                }
                if (!renewed) {
                    execution.cancel(true);
                    return Optional.empty();
                }
            } catch (InterruptedException interrupted) {
                execution.cancel(true);
                Thread.currentThread().interrupt();
                return Optional.empty();
            } catch (ExecutionException failed) {
                execution.cancel(true);
                return Optional.of(JobExecutionOutcome.failure(
                        JobExecutionStatus.EXECUTION_FAILED,
                        "CONNECTOR_EXECUTION_COORDINATOR_FAILURE",
                        Instant.now(clock)));
            }
        }
    }

    private JobExecutionOutcome timeoutOutcome() {
        return JobExecutionOutcome.failure(
                JobExecutionStatus.EXECUTION_TIMEOUT,
                "CONNECTOR_EXECUTION_TIMEOUT",
                Instant.now(clock));
    }

    @Override
    public void close() {
        executionPool.shutdownNow();
    }

    private static Duration requirePositive(
            Duration value,
            String field) {
        Objects.requireNonNull(value, field);
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(field + " must be positive");
        }
        return value;
    }

    private static long positiveNanos(Duration duration) {
        try {
            return Math.max(1L, duration.toNanos());
        } catch (ArithmeticException overflow) {
            return Long.MAX_VALUE;
        }
    }

    private static long saturatingAdd(long left, long right) {
        if (right > 0 && left > Long.MAX_VALUE - right) {
            return Long.MAX_VALUE;
        }
        return left + right;
    }
}
