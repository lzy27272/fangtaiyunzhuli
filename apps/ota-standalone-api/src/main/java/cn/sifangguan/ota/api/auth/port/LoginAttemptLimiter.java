package cn.sifangguan.ota.api.auth.port;

import java.time.Instant;

public interface LoginAttemptLimiter {
    Decision acquire(String canonicalUsername, String sourceAddress, Instant now);

    record Decision(boolean allowed, long retryAfterSeconds) {
        public static Decision allow() {
            return new Decision(true, 0);
        }

        public static Decision deny(long retryAfterSeconds) {
            return new Decision(false, Math.max(1, retryAfterSeconds));
        }
    }
}
