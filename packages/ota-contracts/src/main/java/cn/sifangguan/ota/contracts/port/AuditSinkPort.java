package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public interface AuditSinkPort {
    void append(AuditRecord record);

    record AuditRecord(
            UUID auditId,
            AuditActor actor,
            Optional<TenantHotelRef> scope,
            String action,
            String outcome,
            String detailsHash,
            Instant occurredAt,
            TraceContext traceContext) {
        public AuditRecord {
            Objects.requireNonNull(auditId, "auditId");
            Objects.requireNonNull(actor, "actor");
            scope = Objects.requireNonNull(scope, "scope");
            action = requireText(action, "action");
            outcome = requireText(outcome, "outcome");
            detailsHash = requireText(detailsHash, "detailsHash");
            Objects.requireNonNull(occurredAt, "occurredAt");
            Objects.requireNonNull(traceContext, "traceContext");
        }
    }

    record AuditActor(
            ActorType type,
            Optional<UUID> accountId,
            Optional<UUID> servicePrincipalId) {
        public AuditActor {
            Objects.requireNonNull(type, "type");
            accountId = Objects.requireNonNull(accountId, "accountId");
            servicePrincipalId = Objects.requireNonNull(servicePrincipalId, "servicePrincipalId");

            var valid = switch (type) {
                case ACCOUNT -> accountId.isPresent() && servicePrincipalId.isEmpty();
                case SERVICE -> accountId.isEmpty() && servicePrincipalId.isPresent();
                case ANONYMOUS -> accountId.isEmpty() && servicePrincipalId.isEmpty();
            };
            if (!valid) {
                throw new IllegalArgumentException(
                        "audit actor identifiers must match and be exclusive for " + type);
            }
        }

        public static AuditActor account(UUID accountId) {
            return new AuditActor(
                    ActorType.ACCOUNT,
                    Optional.of(Objects.requireNonNull(accountId, "accountId")),
                    Optional.empty());
        }

        public static AuditActor service(UUID servicePrincipalId) {
            return new AuditActor(
                    ActorType.SERVICE,
                    Optional.empty(),
                    Optional.of(Objects.requireNonNull(servicePrincipalId, "servicePrincipalId")));
        }

        public static AuditActor anonymous() {
            return new AuditActor(ActorType.ANONYMOUS, Optional.empty(), Optional.empty());
        }
    }

    enum ActorType {
        ACCOUNT,
        SERVICE,
        ANONYMOUS
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
