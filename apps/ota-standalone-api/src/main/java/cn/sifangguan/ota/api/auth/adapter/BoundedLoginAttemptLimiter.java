package cn.sifangguan.ota.api.auth.adapter;

import cn.sifangguan.ota.api.auth.port.LoginAttemptLimiter;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.Iterator;
import java.util.Map;

public final class BoundedLoginAttemptLimiter implements LoginAttemptLimiter {
    private final int maxBuckets;
    private final int attemptsPerAccount;
    private final int attemptsPerSource;
    private final Duration window;
    private final Map<String, Bucket> buckets = new HashMap<>();

    public BoundedLoginAttemptLimiter(
            int maxBuckets,
            int attemptsPerAccount,
            int attemptsPerSource,
            Duration window
    ) {
        if (maxBuckets < 100 || attemptsPerAccount < 1 || attemptsPerSource < attemptsPerAccount
                || window == null || window.isZero() || window.isNegative()) {
            throw new IllegalArgumentException("Invalid login limiter configuration");
        }
        this.maxBuckets = maxBuckets;
        this.attemptsPerAccount = attemptsPerAccount;
        this.attemptsPerSource = attemptsPerSource;
        this.window = window;
    }

    @Override
    public synchronized Decision acquire(String canonicalUsername, String sourceAddress, Instant now) {
        removeExpired(now);
        String accountKey = "account:" + fingerprint(canonicalUsername == null ? "" : canonicalUsername);
        String sourceKey = "source:" + fingerprint(sourceAddress == null ? "unknown" : sourceAddress);
        Bucket account = buckets.get(accountKey);
        Bucket source = buckets.get(sourceKey);
        if ((account == null || source == null) && buckets.size() + missingCount(account, source) > maxBuckets) {
            // Capacity exhaustion is a security failure, not permission to bypass the limiter.
            return Decision.deny(window.toSeconds());
        }
        Decision accountDecision = decision(account, attemptsPerAccount, now);
        if (!accountDecision.allowed()) {
            return accountDecision;
        }
        Decision sourceDecision = decision(source, attemptsPerSource, now);
        if (!sourceDecision.allowed()) {
            return sourceDecision;
        }
        buckets.computeIfAbsent(accountKey, ignored -> new Bucket(now.plus(window))).attempts++;
        buckets.computeIfAbsent(sourceKey, ignored -> new Bucket(now.plus(window))).attempts++;
        return Decision.allow();
    }

    private Decision decision(Bucket bucket, int limit, Instant now) {
        if (bucket == null || bucket.attempts < limit) {
            return Decision.allow();
        }
        return Decision.deny(Duration.between(now, bucket.resetAt).toSeconds());
    }

    private void removeExpired(Instant now) {
        Iterator<Bucket> iterator = buckets.values().iterator();
        while (iterator.hasNext()) {
            if (!now.isBefore(iterator.next().resetAt)) {
                iterator.remove();
            }
        }
    }

    private static int missingCount(Bucket account, Bucket source) {
        return (account == null ? 1 : 0) + (source == null ? 1 : 0);
    }

    private static String fingerprint(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest, 0, 16);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static final class Bucket {
        private int attempts;
        private final Instant resetAt;

        private Bucket(Instant resetAt) {
            this.resetAt = resetAt;
        }
    }
}
