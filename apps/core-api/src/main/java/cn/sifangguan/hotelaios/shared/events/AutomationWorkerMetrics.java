package cn.sifangguan.hotelaios.shared.events;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;

/** Low-cardinality operational metrics for the tenant automation worker. */
@Component
public class AutomationWorkerMetrics {
    static final String RUNS = "hotel.ai.os.automation.worker.runs";
    static final String ITEMS = "hotel.ai.os.automation.worker.items";
    static final String ALERTS = "hotel.ai.os.automation.worker.alerts";
    static final String DURATION = "hotel.ai.os.automation.worker.duration";
    static final String DEAD_LETTERS = "hotel.ai.os.automation.worker.dead.letters";

    private final MeterRegistry registry;
    private final AtomicInteger outboxDeadLetters = new AtomicInteger();
    private final AtomicInteger managementEventDeadLetters = new AtomicInteger();

    public AutomationWorkerMetrics(MeterRegistry registry) {
        this.registry = registry;
        Gauge.builder(DEAD_LETTERS, outboxDeadLetters, AtomicInteger::get)
                .tag("queue", "outbox")
                .description("Current dead-letter records visible to the latest worker run")
                .register(registry);
        Gauge.builder(DEAD_LETTERS, managementEventDeadLetters, AtomicInteger::get)
                .tag("queue", "management_event")
                .description("Current dead-letter records visible to the latest worker run")
                .register(registry);
    }

    public void success(String pipeline, int itemCount, Duration duration) {
        runCounter(pipeline, "success").increment();
        if (itemCount > 0) {
            Counter.builder(ITEMS).tag("pipeline", pipeline).register(registry).increment(itemCount);
        }
        timer(pipeline, "success").record(duration);
    }

    public void failure(String pipeline, Duration duration) {
        runCounter(pipeline, "failure").increment();
        timer(pipeline, "failure").record(duration);
    }

    public void alert(String pipeline, String code) {
        Counter.builder(ALERTS)
                .tag("pipeline", pipeline)
                .tag("code", code)
                .register(registry)
                .increment();
    }

    public void deadLetters(int outboxCount, int managementEventCount) {
        outboxDeadLetters.set(Math.max(0, outboxCount));
        managementEventDeadLetters.set(Math.max(0, managementEventCount));
    }

    private Counter runCounter(String pipeline, String outcome) {
        return Counter.builder(RUNS)
                .tag("pipeline", pipeline)
                .tag("outcome", outcome)
                .register(registry);
    }

    private Timer timer(String pipeline, String outcome) {
        return Timer.builder(DURATION)
                .tag("pipeline", pipeline)
                .tag("outcome", outcome)
                .register(registry);
    }
}
