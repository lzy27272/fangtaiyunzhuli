package cn.sifangguan.ota.contracts.port;

import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

public interface IdentityProviderPort {
    Optional<IdentityAccount> resolve(ExternalIdentity identity);

    record ExternalIdentity(String issuer, String subject) {
        public ExternalIdentity {
            issuer = requireText(issuer, "issuer");
            subject = requireText(subject, "subject");
        }
    }

    record IdentityAccount(UUID accountId, Set<String> roles, long authorizationVersion, boolean enabled) {
        public IdentityAccount {
            Objects.requireNonNull(accountId, "accountId");
            roles = Set.copyOf(Objects.requireNonNull(roles, "roles"));
            if (authorizationVersion < 1) {
                throw new IllegalArgumentException("authorizationVersion must be positive");
            }
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
