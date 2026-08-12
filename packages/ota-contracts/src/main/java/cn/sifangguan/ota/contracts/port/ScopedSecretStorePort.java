package cn.sifangguan.ota.contracts.port;

import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Policy-bound SecretStore boundary for connector workers.
 *
 * <p>Unscoped access is deliberately disabled. A production adapter must enforce the service
 * principal, work item, purpose and expiry again at the provider boundary and append a
 * privacy-minimized access audit event.
 */
public interface ScopedSecretStorePort extends SecretStorePort {
    Duration MAX_LEASE = Duration.ofMinutes(5);

    ScopedSecretLease open(SecretAccessRequest request);

    @Override
    default SecretLease open(SecretReference reference) {
        throw new SecurityException("Unscoped secret access is disabled");
    }

    record SecretAccessRequest(
            SecretReference reference,
            UUID servicePrincipalId,
            UUID workItemId,
            String operationCode,
            Instant requestedAt,
            Instant expiresAt
    ) {
        private static final Pattern SAFE_OPERATION = Pattern.compile("[A-Z][A-Z0-9_]{2,63}");

        public SecretAccessRequest {
            Objects.requireNonNull(reference, "reference");
            Objects.requireNonNull(servicePrincipalId, "servicePrincipalId");
            Objects.requireNonNull(workItemId, "workItemId");
            Objects.requireNonNull(operationCode, "operationCode");
            Objects.requireNonNull(requestedAt, "requestedAt");
            Objects.requireNonNull(expiresAt, "expiresAt");
            if (!SAFE_OPERATION.matcher(operationCode).matches()) {
                throw new IllegalArgumentException("operationCode must be a controlled uppercase code");
            }
            if (!expiresAt.isAfter(requestedAt)
                    || Duration.between(requestedAt, expiresAt).compareTo(MAX_LEASE) > 0) {
                throw new IllegalArgumentException("secret lease must be positive and at most five minutes");
            }
        }

        @Override
        public String toString() {
            return "SecretAccessRequest[reference=<redacted>, servicePrincipalId=<redacted>, "
                    + "workItemId=<redacted>, operationCode=" + operationCode
                    + ", requestedAt=<redacted>, expiresAt=<redacted>]";
        }
    }

    interface ScopedSecretLease extends SecretLease {
        UUID leaseId();

        Instant expiresAt();

        String operationCode();
    }
}
