package cn.sifangguan.ota.browsersession;

import java.time.Instant;
import java.util.Objects;

public final class OfflineBrowserSessionHelper implements BrowserSessionHelperPort {
    private final BrowserSessionStateMachine stateMachine;
    private final ExactTargetAllowlistPolicy targetPolicy;

    public OfflineBrowserSessionHelper(
            BrowserSessionStateMachine stateMachine,
            ExactTargetAllowlistPolicy targetPolicy) {
        this.stateMachine = Objects.requireNonNull(stateMachine, "stateMachine");
        this.targetPolicy = Objects.requireNonNull(targetPolicy, "targetPolicy");
    }

    @Override
    public BrowserSessionSnapshot transition(
            BrowserSessionSnapshot current,
            BrowserSessionEvent event,
            Instant occurredAt) {
        return stateMachine.transition(current, event, occurredAt);
    }

    @Override
    public BrowserTargetAuthorization authorize(
            BrowserSessionSnapshot current,
            BrowserHopAuthorizationRequest request) {
        return targetPolicy.authorize(current, request);
    }
}
