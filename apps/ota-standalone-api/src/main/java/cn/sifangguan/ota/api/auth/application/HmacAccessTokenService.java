package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import com.fasterxml.jackson.databind.ObjectMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public final class HmacAccessTokenService implements AccessTokenService {
    private static final String HMAC_ALGORITHM = "HmacSHA256";
    private static final Base64.Encoder URL_ENCODER = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder URL_DECODER = Base64.getUrlDecoder();
    private static final int MAX_TOKEN_LENGTH = 8_192;

    private final ObjectMapper objectMapper;
    private final Clock clock;
    private final String issuer;
    private final Duration accessTtl;
    private final String currentKeyId;
    private final Map<String, SigningKey> verificationKeys;

    public HmacAccessTokenService(
            ObjectMapper objectMapper,
            Clock clock,
            String issuer,
            Duration accessTtl,
            String currentKeyId,
            Map<String, SigningKey> verificationKeys
    ) {
        this.objectMapper = objectMapper;
        this.clock = clock;
        this.issuer = requireText(issuer, "issuer");
        if (accessTtl == null || accessTtl.isNegative() || accessTtl.isZero()
                || accessTtl.compareTo(Duration.ofMinutes(15)) > 0) {
            throw new IllegalArgumentException("Access token TTL must be between 1 second and 15 minutes");
        }
        this.accessTtl = accessTtl;
        this.currentKeyId = requireText(currentKeyId, "currentKeyId");
        this.verificationKeys = Map.copyOf(verificationKeys);
        if (!this.verificationKeys.containsKey(currentKeyId)) {
            throw new IllegalArgumentException("Current signing key is missing");
        }
    }

    @Override
    public IssuedAccessToken issue(LocalAccount account, UUID sessionId) {
        Instant issuedAt = clock.instant();
        Instant expiresAt = issuedAt.plus(accessTtl);
        JwtHeader header = new JwtHeader("HS256", "JWT", currentKeyId);
        JwtPayload payload = new JwtPayload(
                issuer,
                account.id().toString(),
                sessionId.toString(),
                issuedAt.getEpochSecond(),
                expiresAt.getEpochSecond(),
                account.authzVersion(),
                account.roles(),
                UUID.randomUUID().toString());
        try {
            String encodedHeader = URL_ENCODER.encodeToString(objectMapper.writeValueAsBytes(header));
            String encodedPayload = URL_ENCODER.encodeToString(objectMapper.writeValueAsBytes(payload));
            String signed = encodedHeader + "." + encodedPayload;
            byte[] signature = sign(signed, verificationKeys.get(currentKeyId).copyKey());
            try {
                return new IssuedAccessToken(signed + "." + URL_ENCODER.encodeToString(signature), expiresAt);
            } finally {
                Arrays.fill(signature, (byte) 0);
            }
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to issue access token", exception);
        }
    }

    @Override
    public AccessTokenClaims verify(String token) {
        try {
            if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {
                throw new InvalidAccessTokenException();
            }
            String[] parts = token.split("\\.", -1);
            if (parts.length != 3 || parts[0].isBlank() || parts[1].isBlank() || parts[2].isBlank()) {
                throw new InvalidAccessTokenException();
            }
            JwtHeader header = objectMapper.readValue(URL_DECODER.decode(parts[0]), JwtHeader.class);
            if (!"HS256".equals(header.alg()) || !"JWT".equals(header.typ())) {
                throw new InvalidAccessTokenException();
            }
            SigningKey signingKey = verificationKeys.get(header.kid());
            Instant now = clock.instant();
            if (signingKey == null || now.isAfter(signingKey.validUntil())) {
                throw new InvalidAccessTokenException();
            }
            byte[] suppliedSignature = URL_DECODER.decode(parts[2]);
            byte[] expectedSignature = sign(parts[0] + "." + parts[1], signingKey.copyKey());
            try {
                if (!MessageDigest.isEqual(expectedSignature, suppliedSignature)) {
                    throw new InvalidAccessTokenException();
                }
            } finally {
                Arrays.fill(expectedSignature, (byte) 0);
                Arrays.fill(suppliedSignature, (byte) 0);
            }
            JwtPayload payload = objectMapper.readValue(URL_DECODER.decode(parts[1]), JwtPayload.class);
            if (!issuer.equals(payload.iss())
                    || payload.exp() <= now.getEpochSecond()
                    || payload.iat() > now.plusSeconds(60).getEpochSecond()
                    || payload.azv() < 1) {
                throw new InvalidAccessTokenException();
            }
            return new AccessTokenClaims(
                    UUID.fromString(payload.sub()),
                    UUID.fromString(payload.sid()),
                    payload.azv(),
                    payload.roles(),
                    Instant.ofEpochSecond(payload.iat()),
                    Instant.ofEpochSecond(payload.exp()),
                    UUID.fromString(payload.jti()));
        } catch (InvalidAccessTokenException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new InvalidAccessTokenException();
        }
    }

    private static byte[] sign(String value, byte[] key) throws GeneralSecurityException {
        try {
            Mac mac = Mac.getInstance(HMAC_ALGORITHM);
            mac.init(new SecretKeySpec(key, HMAC_ALGORITHM));
            return mac.doFinal(value.getBytes(StandardCharsets.US_ASCII));
        } finally {
            Arrays.fill(key, (byte) 0);
        }
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }

    public static final class SigningKey {
        private final byte[] key;
        private final Instant validUntil;

        public SigningKey(byte[] key, Instant validUntil) {
            if (key == null || key.length < 32) {
                throw new IllegalArgumentException("HS256 key must contain at least 256 bits");
            }
            this.key = Arrays.copyOf(key, key.length);
            this.validUntil = validUntil == null ? Instant.MAX : validUntil;
        }

        private byte[] copyKey() {
            return Arrays.copyOf(key, key.length);
        }

        public Instant validUntil() {
            return validUntil;
        }
    }

    private record JwtHeader(String alg, String typ, String kid) {
    }

    private record JwtPayload(
            String iss,
            String sub,
            String sid,
            long iat,
            long exp,
            long azv,
            Set<OtaRole> roles,
            String jti
    ) {
        private JwtPayload {
            roles = Set.copyOf(roles);
        }
    }
}
