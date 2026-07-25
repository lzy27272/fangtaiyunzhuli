package cn.sifangguan.ota.api.auth.application;

public interface PasswordHasher {
    String hash(char[] password);

    boolean matches(char[] password, String encodedPassword);

    boolean needsUpgrade(String encodedPassword);
}
