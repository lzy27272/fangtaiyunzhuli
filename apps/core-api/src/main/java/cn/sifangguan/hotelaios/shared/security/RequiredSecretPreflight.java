package cn.sifangguan.hotelaios.shared.security;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class RequiredSecretPreflight {

    private static final List<String> REQUIRED_SECRET_VARIABLES = List.of(
            "DB_PASSWORD",
            "DB_MIGRATION_PASSWORD");

    private RequiredSecretPreflight() {
    }

    public static void validate(Map<String, String> environment) {
        Objects.requireNonNull(environment, "environment");
        List<String> missing = new ArrayList<>();
        for (String variable : REQUIRED_SECRET_VARIABLES) {
            String value = environment.get(variable);
            if (value == null || value.isBlank()) {
                missing.add(variable);
            }
        }
        if (!missing.isEmpty()) {
            throw new IllegalStateException(
                    "Required secret environment variables are missing or blank: " + String.join(", ", missing));
        }
    }
}
