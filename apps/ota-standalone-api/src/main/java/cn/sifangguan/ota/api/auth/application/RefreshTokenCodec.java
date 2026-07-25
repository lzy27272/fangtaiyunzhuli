package cn.sifangguan.ota.api.auth.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

public final class RefreshTokenCodec {
    private static final int TOKEN_BYTES = 32;
    private final SecureRandom secureRandom;

    public RefreshTokenCodec(SecureRandom secureRandom) {
        this.secureRandom = secureRandom;
    }

    public String generate() {
        byte[] value = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(value);
        try {
            return Base64.getUrlEncoder().withoutPadding().encodeToString(value);
        } finally {
            java.util.Arrays.fill(value, (byte) 0);
        }
    }

    public String digest(String rawToken) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.US_ASCII));
            try {
                return HexFormat.of().formatHex(digest);
            } finally {
                java.util.Arrays.fill(digest, (byte) 0);
            }
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
