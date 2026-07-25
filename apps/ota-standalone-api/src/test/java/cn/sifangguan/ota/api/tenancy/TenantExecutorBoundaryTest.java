package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TenantExecutorBoundaryTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-07-23T00:00:00Z"), ZoneOffset.UTC);

    @Test
    void crossTenantReadUsesIndependentReadOnlyContextsAndReportsPartialCoverage() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        List<String> contexts = new ArrayList<>();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID tenantId, boolean readOnly, java.util.function.Supplier<T> work) {
                contexts.add(tenantId + ":" + readOnly);
                return work.get();
            }
        };
        RecordingAuditPort audit = new RecordingAuditPort();
        CrossTenantReadExecutor executor = new CrossTenantReadExecutor(
                () -> List.of(first, second), tenantContext, audit, CLOCK);
        TrustedAuthorizationContext authorization = context(OtaRole.CEO);

        CrossTenantReadResult<String> result = executor.read(
                authorization,
                tenant -> {
                    if (tenant.equals(second)) {
                        throw new IllegalStateException("source unavailable");
                    }
                    return "visible";
                },
                "read-1");

        assertThat(result.coverage()).isEqualTo(CrossTenantReadResult.Coverage.PARTIAL);
        assertThat(result.values()).containsEntry(first, "visible");
        assertThat(result.failures()).extracting(CrossTenantReadResult.TenantFailure::tenantId)
                .containsExactly(second);
        assertThat(contexts).containsExactlyInAnyOrder(first + ":true", second + ":true");
        AuditEvent coverageAudit = audit.independent.getLast();
        assertThat(coverageAudit.resourceType()).isEqualTo("TENANT_COVERAGE");
        assertThat(coverageAudit.coverageCode()).isEqualTo("PARTIAL");
        assertThat(coverageAudit.conditionHash()).hasSize(64);
    }

    @Test
    void privilegedCommandsAcceptOnlyPlatformAdminAndOneExplicitTenant() {
        UUID tenantId = UUID.randomUUID();
        AtomicBoolean handled = new AtomicBoolean();
        List<String> contexts = new ArrayList<>();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID id, boolean readOnly, java.util.function.Supplier<T> work) {
                contexts.add(id + ":" + readOnly);
                return work.get();
            }
        };
        TenantConfigurationCommandHandler handler = command -> {
            handled.set(true);
            return new TenantConfigurationCommandHandler.CommandReceipt("command-1", 2);
        };
        RecordingAuditPort audit = new RecordingAuditPort();
        PrivilegedTenantCommandExecutor executor = new PrivilegedTenantCommandExecutor(
                tenantContext, handler, audit, CLOCK);
        UpsertHotelConfigurationCommand command = new UpsertHotelConfigurationCommand(
                tenantId, UUID.randomUUID(), "idempotency-0001", 1, "PILOT_CONFIG");

        assertThatThrownBy(() -> executor.execute(context(OtaRole.CEO), command, "cmd-denied"))
                .isInstanceOf(SecurityException.class);
        assertThat(handled).isFalse();
        assertThat(audit.independent.getLast().targetTenantId()).isEqualTo(tenantId);
        assertThat(audit.independent.getLast().resourceType()).isEqualTo("HOTEL_CONFIG");

        executor.execute(context(OtaRole.PLATFORM_ADMIN), command, "cmd-allowed");
        assertThat(handled).isTrue();
        assertThat(contexts).containsExactly(tenantId + ":false");
        assertThat(audit.inCurrent).hasSize(1);
        assertThat(audit.inCurrent.getFirst().outcome()).isEqualTo("SUCCEEDED");

        UpsertHotelConfigurationCommand invalid = new UpsertHotelConfigurationCommand(
                tenantId, command.hotelId(), "short", 1, "PILOT_CONFIG");
        assertThatThrownBy(() -> executor.execute(context(OtaRole.PLATFORM_ADMIN), invalid, "cmd-invalid"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(audit.independent.getLast().reasonCode()).isEqualTo("INVALID_COMMAND_ENVELOPE");
    }

    private static TrustedAuthorizationContext context(OtaRole role) {
        LocalAccount account = new LocalAccount(
                UUID.randomUUID(), "account", "Account", AccountStatus.ACTIVE, 1, Set.of(role));
        return TrustedAuthorizationContext.fromCurrentAccount(account);
    }

    private static final class RecordingAuditPort implements AuditPort {
        private final List<AuditEvent> independent = new ArrayList<>();
        private final List<AuditEvent> inCurrent = new ArrayList<>();

        @Override
        public void append(AuditEvent event) {
            independent.add(event);
        }

        @Override
        public void appendInCurrentTransaction(AuditEvent event) {
            inCurrent.add(event);
        }
    }
}
