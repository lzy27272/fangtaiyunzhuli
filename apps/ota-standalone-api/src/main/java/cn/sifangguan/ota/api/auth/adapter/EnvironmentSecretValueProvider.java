package cn.sifangguan.ota.api.auth.adapter;

import cn.sifangguan.ota.api.auth.port.SecretValueProvider;

import java.util.regex.Pattern;

public final class EnvironmentSecretValueProvider implements SecretValueProvider {
    private static final Pattern SAFE_ENV_NAME = Pattern.compile("[A-Z][A-Z0-9_]{2,127}");

    @Override
    public char[] resolve(String secretReference) {
        if (secretReference == null || !secretReference.startsWith("env:")) {
            throw new IllegalStateException("Only registered env: secret references are supported by this adapter");
        }
        String variableName = secretReference.substring("env:".length());
        if (!SAFE_ENV_NAME.matcher(variableName).matches()) {
            throw new IllegalStateException("Secret reference contains an invalid environment variable name");
        }
        String value = System.getenv(variableName);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("Required secret reference cannot be resolved");
        }
        return value.toCharArray();
    }
}
