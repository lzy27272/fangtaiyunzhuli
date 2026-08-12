package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.contracts.gateway.GatewayErrorCode;
import cn.sifangguan.ota.contracts.gateway.GatewayRequestMetadata;
import cn.sifangguan.ota.contracts.gateway.GatewayScope;

import java.time.Clock;
import java.util.Objects;
import java.util.UUID;

/**
 * Offline command admission only. It never invokes PMS, OTA, WeCom, a model provider or a
 * production SecretStore.
 */
public final class GatewayCommandAdmissionService {
    private final GatewayAuthorizationService authorization;
    private final GatewayIdempotencyPort idempotency;
    private final AuditPort audit;
    private final Clock clock;

    public GatewayCommandAdmissionService(
            GatewayAuthorizationService authorization,
            GatewayIdempotencyPort idempotency,
            AuditPort audit,
            Clock clock
    ) {
        this.authorization = Objects.requireNonNull(authorization, "authorization");
        this.idempotency = Objects.requireNonNull(idempotency, "idempotency");
        this.audit = Objects.requireNonNull(audit, "audit");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public AdmissionReceipt admit(
            TrustedAuthorizationContext trusted,
            GatewayScope scope,
            GatewayAction action,
            GatewayRequestMetadata metadata,
            long currentVersion
    ) {
        Objects.requireNonNull(trusted, "trusted");
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(metadata, "metadata");
        if (currentVersion < 0) {
            return deny(
                    trusted, scope, action, metadata,
                    GatewayErrorCode.INVALID_COMMAND_ENVELOPE,
                    "currentVersion must not be negative");
        }

        try {
            authorization.require(trusted, scope, action);
        } catch (GatewayAdmissionException exception) {
            auditDenied(trusted, scope, action, metadata, exception.code());
            throw exception;
        }

        if (metadata.expectedVersion() != currentVersion) {
            return deny(
                    trusted, scope, action, metadata,
                    GatewayErrorCode.VERSION_CONFLICT,
                    "The command expected version does not match the current resource version");
        }

        GatewayIdempotencyPort.Reservation reservation = new GatewayIdempotencyPort.Reservation(
                UUID.randomUUID(),
                trusted.accountId(),
                scope,
                action,
                metadata.idempotencyKey(),
                metadata.expectedVersion(),
                metadata.requestHash());
        GatewayIdempotencyPort.ReservationResult reservationResult = idempotency.reserve(reservation);
        if (reservationResult.outcome() == GatewayIdempotencyPort.ReservationOutcome.CONFLICT) {
            return deny(
                    trusted, scope, action, metadata,
                    GatewayErrorCode.IDEMPOTENCY_CONFLICT,
                    "The idempotency key was already used for a different command");
        }

        boolean replayed = reservationResult.outcome()
                == GatewayIdempotencyPort.ReservationOutcome.REPLAYED;
        audit.appendInCurrentTransaction(event(
                trusted,
                scope,
                action,
                metadata,
                replayed ? "REPLAYED" : "ADMITTED",
                null));
        return new AdmissionReceipt(reservationResult.admissionId(), replayed, currentVersion);
    }

    private AdmissionReceipt deny(
            TrustedAuthorizationContext trusted,
            GatewayScope scope,
            GatewayAction action,
            GatewayRequestMetadata metadata,
            GatewayErrorCode code,
            String message
    ) {
        auditDenied(trusted, scope, action, metadata, code);
        throw new GatewayAdmissionException(code, message);
    }

    private void auditDenied(
            TrustedAuthorizationContext trusted,
            GatewayScope scope,
            GatewayAction action,
            GatewayRequestMetadata metadata,
            GatewayErrorCode code
    ) {
        audit.append(event(trusted, scope, action, metadata, "DENIED", code.name()));
    }

    private AuditEvent event(
            TrustedAuthorizationContext trusted,
            GatewayScope scope,
            GatewayAction action,
            GatewayRequestMetadata metadata,
            String outcome,
            String reason
    ) {
        return new AuditEvent(
                UUID.randomUUID(),
                "OTA_GATEWAY_COMMAND_ADMISSION",
                trusted.accountId(),
                outcome,
                reason,
                metadata.correlationId(),
                clock.instant(),
                action.name(),
                null,
                scope.tenantId(),
                scope.hotelId(),
                action.hotelScopeType(),
                metadata.requestHash());
    }

    public record AdmissionReceipt(UUID admissionId, boolean replayed, long resourceVersion) {
        public AdmissionReceipt {
            Objects.requireNonNull(admissionId, "admissionId");
            if (resourceVersion < 0) {
                throw new IllegalArgumentException("resourceVersion must not be negative");
            }
        }
    }
}
