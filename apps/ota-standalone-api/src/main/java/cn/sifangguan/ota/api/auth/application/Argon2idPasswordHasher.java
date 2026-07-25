package cn.sifangguan.ota.api.auth.application;

import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

import java.nio.CharBuffer;

public final class Argon2idPasswordHasher implements PasswordHasher {
    private static final int SALT_BYTES = 16;
    private static final int HASH_BYTES = 32;
    private static final int PARALLELISM = 1;
    private static final int MEMORY_KIB = 65_536;
    private static final int ITERATIONS = 3;

    private final Argon2PasswordEncoder delegate = new Argon2PasswordEncoder(
            SALT_BYTES, HASH_BYTES, PARALLELISM, MEMORY_KIB, ITERATIONS);

    @Override
    public String hash(char[] password) {
        return delegate.encode(CharBuffer.wrap(password));
    }

    @Override
    public boolean matches(char[] password, String encodedPassword) {
        return delegate.matches(CharBuffer.wrap(password), encodedPassword);
    }

    @Override
    public boolean needsUpgrade(String encodedPassword) {
        return delegate.upgradeEncoding(encodedPassword);
    }
}
