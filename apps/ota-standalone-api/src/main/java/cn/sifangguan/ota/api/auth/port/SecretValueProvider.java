package cn.sifangguan.ota.api.auth.port;

public interface SecretValueProvider {
    char[] resolve(String secretReference);
}
