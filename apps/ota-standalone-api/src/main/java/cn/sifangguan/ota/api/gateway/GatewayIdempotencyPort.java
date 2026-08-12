package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.contracts.gateway.GatewayScope;

import java.util.Objects;
import java.util.UUID;

/** Must be implemented by an atomic database reservation in a later migration-backed adapter. */
public interface GatewayIdempotencyPort {
    /**
     * Atomically reserves by actor, tenant, hotel, action and idempotency key. A replay must
     * return the original admission identifier; the caller's proposed identifier is ignored.
     */
    ReservationResult reserve(Reservation reservation);

    enum ReservationOutcome {
        CREATED,
        REPLAYED,
        CONFLICT
    }

    record Reservation(
            UUID proposedAdmissionId,
            UUID actorAccountId,
            GatewayScope scope,
            GatewayAction action,
            String idempotencyKey,
            long expectedVersion,
            String requestHash
    ) {
        public Reservation {
            Objects.requireNonNull(proposedAdmissionId, "proposedAdmissionId");
            Objects.requireNonNull(actorAccountId, "actorAccountId");
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(action, "action");
            Objects.requireNonNull(idempotencyKey, "idempotencyKey");
            Objects.requireNonNull(requestHash, "requestHash");
        }

        public boolean sameCommandAs(Reservation other) {
            return other != null
                    && actorAccountId.equals(other.actorAccountId)
                    && scope.equals(other.scope)
                    && action == other.action
                    && idempotencyKey.equals(other.idempotencyKey)
                    && expectedVersion == other.expectedVersion
                    && requestHash.equals(other.requestHash);
        }
    }

    record ReservationResult(ReservationOutcome outcome, UUID admissionId) {
        public ReservationResult {
            Objects.requireNonNull(outcome, "outcome");
            Objects.requireNonNull(admissionId, "admissionId");
        }
    }
}
