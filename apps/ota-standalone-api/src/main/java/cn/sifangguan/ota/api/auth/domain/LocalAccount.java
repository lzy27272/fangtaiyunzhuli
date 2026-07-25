package cn.sifangguan.ota.api.auth.domain;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public record LocalAccount(
        UUID id,
        String username,
        String displayName,
        AccountStatus status,
        long authzVersion,
        Set<OtaRole> roles
) {
    public LocalAccount {
        Objects.requireNonNull(id, "id");
        username = requireText(username, "username");
        displayName = requireText(displayName, "displayName");
        Objects.requireNonNull(status, "status");
        if (authzVersion < 1) {
            throw new IllegalArgumentException("authzVersion must be positive");
        }
        roles = Set.copyOf(roles);
    }

    public boolean isActive() {
        return status == AccountStatus.ACTIVE;
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
