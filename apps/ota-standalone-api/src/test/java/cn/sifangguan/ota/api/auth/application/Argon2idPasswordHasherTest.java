package cn.sifangguan.ota.api.auth.application;

import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThat;

class Argon2idPasswordHasherTest {
    private final PasswordHasher hasher = new Argon2idPasswordHasher();

    @Test
    void hashesWithArgon2idAndNeverStoresPlaintext() {
        char[] password = "correct horse battery staple".toCharArray();
        try {
            String encoded = hasher.hash(password);
            assertThat(encoded).startsWith("$argon2id$");
            assertThat(encoded).doesNotContain(new String(password));
            assertThat(hasher.matches(password, encoded)).isTrue();
            assertThat(hasher.matches("wrong password value".toCharArray(), encoded)).isFalse();
        } finally {
            Arrays.fill(password, '\0');
        }
    }
}
