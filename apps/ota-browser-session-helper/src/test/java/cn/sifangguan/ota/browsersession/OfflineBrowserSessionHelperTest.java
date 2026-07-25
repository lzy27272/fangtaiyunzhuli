package cn.sifangguan.ota.browsersession;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class OfflineBrowserSessionHelperTest {
    @Test
    void composesLifecycleAndAuthorizationWithoutIo() {
        var target = BrowserTarget.httpsGet(
                "pms.example.test",
                "/approved/report");
        BrowserSessionHelperPort helper = new OfflineBrowserSessionHelper(
                new BrowserSessionStateMachine(),
                new ExactTargetAllowlistPolicy(Set.of(target)));
        var createdAt = Instant.parse("2026-07-25T04:00:00Z");
        var binding = new BrowserSessionBinding(
                "tenant-1",
                "hotel-1",
                "connector-1",
                "1.0.0",
                "config-7",
                "actor-1",
                UUID.randomUUID());
        var pending = BrowserSessionSnapshot.pending(binding, createdAt);

        var active = helper.transition(
                pending,
                BrowserSessionEvent.INTERACTIVE_LOGIN_CONFIRMED,
                createdAt.plusSeconds(1));
        var decision = helper.authorize(
                active,
                new BrowserHopAuthorizationRequest(
                        binding,
                        target,
                        Set.of(new ResolvedNetworkAddress("1.1.1.1")),
                        0));

        assertEquals(BrowserSessionState.ACTIVE, active.state());
        assertTrue(decision.allowed());
    }
}
