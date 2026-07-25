package cn.sifangguan.ota.browsersession;

import java.time.Instant;

public interface BrowserSessionHelperPort {
    BrowserSessionSnapshot transition(
            BrowserSessionSnapshot current,
            BrowserSessionEvent event,
            Instant occurredAt);

    BrowserTargetAuthorization authorize(
            BrowserSessionSnapshot current,
            BrowserHopAuthorizationRequest request);
}
