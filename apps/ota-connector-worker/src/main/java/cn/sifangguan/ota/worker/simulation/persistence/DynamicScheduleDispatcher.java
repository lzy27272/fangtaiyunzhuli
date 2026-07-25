package cn.sifangguan.ota.worker.simulation.persistence;

import org.springframework.scheduling.annotation.Scheduled;

import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Discovers enabled due schedules from the database, so adding a configured
 * hotel does not require a code change or process restart.
 */
public final class DynamicScheduleDispatcher {
    private final DynamicSchedulePort port;
    private final UUID schedulerServicePrincipalId;
    private final Clock clock;
    private final int batchLimit;
    private final AtomicBoolean dispatching = new AtomicBoolean();

    public DynamicScheduleDispatcher(
            DynamicSchedulePort port,
            UUID schedulerServicePrincipalId,
            Clock clock,
            int batchLimit) {
        this.port = Objects.requireNonNull(port, "port");
        this.schedulerServicePrincipalId = Objects.requireNonNull(
                schedulerServicePrincipalId, "schedulerServicePrincipalId");
        this.clock = Objects.requireNonNull(clock, "clock");
        if (batchLimit < 1 || batchLimit > 500) {
            throw new IllegalArgumentException("batchLimit must be within [1,500]");
        }
        this.batchLimit = batchLimit;
    }

    @Scheduled(
            fixedDelayString = "${ota.sprint1.simulation.dispatch-delay:5s}",
            initialDelayString = "${ota.sprint1.simulation.dispatch-delay:5s}")
    public void dispatchOnce() {
        if (!dispatching.compareAndSet(false, true)) {
            return;
        }
        try {
            port.dispatchDue(
                    schedulerServicePrincipalId,
                    Instant.now(clock),
                    batchLimit);
        } finally {
            dispatching.set(false);
        }
    }
}
