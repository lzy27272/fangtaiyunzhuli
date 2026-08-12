package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.contracts.gateway.GatewayErrorCode;
import cn.sifangguan.ota.contracts.gateway.GatewayRequestMetadata;
import cn.sifangguan.ota.contracts.gateway.GatewayScope;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class GatewayCommandAdmissionServiceTest {
    private static final Clock CLOCK = Clock.fixed(
            Instant.parse("2026-08-11T01:00:00Z"), ZoneOffset.UTC);

    @Test
    void admitsAndReplaysOnlyTheSameScopedCommand() {
        UUID accountId = UUID.randomUUID();
        GatewayScope scope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());
        RecordingAudit audit = new RecordingAudit();
        InMemoryIdempotency idempotency = new InMemoryIdempotency();
        GatewayCommandAdmissionService service = service(
                accountId, scope, GatewayAction.PRICE_REQUEST_CREATE, idempotency, audit);
        GatewayRequestMetadata metadata = metadata("offline-request-0001", 4, "a".repeat(64));

        var first = service.admit(
                context(accountId, OtaRole.GENERAL_MANAGER),
                scope,
                GatewayAction.PRICE_REQUEST_CREATE,
                metadata,
                4);
        var replay = service.admit(
                context(accountId, OtaRole.GENERAL_MANAGER),
                scope,
                GatewayAction.PRICE_REQUEST_CREATE,
                metadata,
                4);

        assertThat(first.replayed()).isFalse();
        assertThat(replay.replayed()).isTrue();
        assertThat(replay.admissionId()).isEqualTo(first.admissionId());
        assertThat(audit.inTransaction).extracting(AuditEvent::outcome)
                .containsExactly("ADMITTED", "REPLAYED");
        assertThat(audit.independent).isEmpty();
    }

    @Test
    void rejectsSameKeyWithDifferentHashAndRecordsIndependentEvidence() {
        UUID accountId = UUID.randomUUID();
        GatewayScope scope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());
        RecordingAudit audit = new RecordingAudit();
        InMemoryIdempotency idempotency = new InMemoryIdempotency();
        GatewayCommandAdmissionService service = service(
                accountId, scope, GatewayAction.PRICE_REQUEST_CREATE, idempotency, audit);
        TrustedAuthorizationContext trusted = context(accountId, OtaRole.GENERAL_MANAGER);

        service.admit(trusted, scope, GatewayAction.PRICE_REQUEST_CREATE,
                metadata("offline-request-0002", 1, "a".repeat(64)), 1);

        assertThatThrownBy(() -> service.admit(
                trusted,
                scope,
                GatewayAction.PRICE_REQUEST_CREATE,
                metadata("offline-request-0002", 1, "b".repeat(64)),
                1))
                .isInstanceOfSatisfying(GatewayAdmissionException.class,
                        exception -> assertThat(exception.code())
                                .isEqualTo(GatewayErrorCode.IDEMPOTENCY_CONFLICT));
        assertThat(audit.independent.getLast().reasonCode())
                .isEqualTo("IDEMPOTENCY_CONFLICT");
    }

    @Test
    void rejectsVersionMismatchBeforeIdempotencyReservation() {
        UUID accountId = UUID.randomUUID();
        GatewayScope scope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());
        RecordingAudit audit = new RecordingAudit();
        InMemoryIdempotency idempotency = new InMemoryIdempotency();
        GatewayCommandAdmissionService service = service(
                accountId, scope, GatewayAction.PRICE_PREVIEW, idempotency, audit);

        assertThatThrownBy(() -> service.admit(
                context(accountId, OtaRole.FRONT_OFFICE_SUPERVISOR),
                scope,
                GatewayAction.PRICE_PREVIEW,
                metadata("offline-preview-0001", 2, "c".repeat(64)),
                3))
                .isInstanceOfSatisfying(GatewayAdmissionException.class,
                        exception -> assertThat(exception.code())
                                .isEqualTo(GatewayErrorCode.VERSION_CONFLICT));
        assertThat(idempotency.records).isEmpty();
        assertThat(audit.independent.getLast().reasonCode()).isEqualTo("VERSION_CONFLICT");
    }

    @Test
    void neverLetsStoreInitiatorApproveOrAnyRoleBypassMissingHotelScope() {
        UUID accountId = UUID.randomUUID();
        GatewayScope scope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());
        RecordingAudit audit = new RecordingAudit();
        GatewayCommandAdmissionService service = service(
                accountId, scope, GatewayAction.PRICE_APPROVE_AND_SYNC,
                new InMemoryIdempotency(), audit);

        assertThatThrownBy(() -> service.admit(
                context(accountId, OtaRole.ASSISTANT_GENERAL_MANAGER),
                scope,
                GatewayAction.PRICE_APPROVE_AND_SYNC,
                metadata("offline-approval-0001", 0, "d".repeat(64)),
                0))
                .isInstanceOfSatisfying(GatewayAdmissionException.class,
                        exception -> assertThat(exception.code())
                                .isEqualTo(GatewayErrorCode.FORBIDDEN_SCOPE));

        GatewayCommandAdmissionService noScope = new GatewayCommandAdmissionService(
                new GatewayAuthorizationService((actor, tenant, hotel, scopeType) -> false),
                new InMemoryIdempotency(),
                audit,
                CLOCK);
        assertThatThrownBy(() -> noScope.admit(
                context(accountId, OtaRole.OTA_OPERATION_MANAGER),
                scope,
                GatewayAction.PRICE_APPROVE_AND_SYNC,
                metadata("offline-approval-0002", 0, "e".repeat(64)),
                0))
                .isInstanceOfSatisfying(GatewayAdmissionException.class,
                        exception -> assertThat(exception.code())
                                .isEqualTo(GatewayErrorCode.FORBIDDEN_SCOPE));
    }

    @Test
    void exactHotelAuthorizationCannotBeReusedWithAnotherTenant() {
        UUID accountId = UUID.randomUUID();
        GatewayScope authorizedScope = new GatewayScope(UUID.randomUUID(), UUID.randomUUID());
        GatewayScope forgedScope = new GatewayScope(UUID.randomUUID(), authorizedScope.hotelId());
        RecordingAudit audit = new RecordingAudit();
        GatewayCommandAdmissionService service = service(
                accountId,
                authorizedScope,
                GatewayAction.PRICE_PREVIEW,
                new InMemoryIdempotency(),
                audit);

        assertThatThrownBy(() -> service.admit(
                context(accountId, OtaRole.GENERAL_MANAGER),
                forgedScope,
                GatewayAction.PRICE_PREVIEW,
                metadata("offline-preview-tenant-0001", 0, "f".repeat(64)),
                0))
                .isInstanceOfSatisfying(GatewayAdmissionException.class,
                        exception -> assertThat(exception.code())
                                .isEqualTo(GatewayErrorCode.FORBIDDEN_SCOPE));
        assertThat(audit.independent.getLast().targetTenantId())
                .isEqualTo(forgedScope.tenantId());
    }

    private static GatewayCommandAdmissionService service(
            UUID accountId,
            GatewayScope scope,
            GatewayAction action,
            GatewayIdempotencyPort idempotency,
            AuditPort audit
    ) {
        return new GatewayCommandAdmissionService(
                new GatewayAuthorizationService((candidate, tenant, hotel, scopeType) ->
                        candidate.equals(accountId)
                                && tenant.equals(scope.tenantId())
                                && hotel.equals(scope.hotelId())
                                && scopeType.equals(action.hotelScopeType())),
                idempotency,
                audit,
                CLOCK);
    }

    private static GatewayRequestMetadata metadata(String key, long version, String hash) {
        return new GatewayRequestMetadata(key, "offline-correlation-0001", version, hash);
    }

    private static TrustedAuthorizationContext context(UUID accountId, OtaRole role) {
        return TrustedAuthorizationContext.fromCurrentAccount(new LocalAccount(
                accountId,
                "offline-account",
                "Offline Account",
                AccountStatus.ACTIVE,
                1,
                Set.of(role)));
    }

    private static final class InMemoryIdempotency implements GatewayIdempotencyPort {
        private final Map<StorageKey, Reservation> records = new HashMap<>();

        @Override
        public ReservationResult reserve(Reservation reservation) {
            StorageKey key = new StorageKey(
                    reservation.actorAccountId(),
                    reservation.scope(),
                    reservation.action(),
                    reservation.idempotencyKey());
            Reservation previous = records.putIfAbsent(key, reservation);
            if (previous == null) {
                return new ReservationResult(
                        ReservationOutcome.CREATED,
                        reservation.proposedAdmissionId());
            }
            return previous.sameCommandAs(reservation)
                    ? new ReservationResult(
                            ReservationOutcome.REPLAYED,
                            previous.proposedAdmissionId())
                    : new ReservationResult(
                            ReservationOutcome.CONFLICT,
                            previous.proposedAdmissionId());
        }

        private record StorageKey(
                UUID actorAccountId,
                GatewayScope scope,
                GatewayAction action,
                String idempotencyKey
        ) {
        }
    }

    private static final class RecordingAudit implements AuditPort {
        private final List<AuditEvent> independent = new ArrayList<>();
        private final List<AuditEvent> inTransaction = new ArrayList<>();

        @Override
        public void append(AuditEvent event) {
            independent.add(event);
        }

        @Override
        public void appendInCurrentTransaction(AuditEvent event) {
            inTransaction.add(event);
        }
    }
}
