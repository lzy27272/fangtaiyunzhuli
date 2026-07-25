package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
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

class Sprint1RevenueManagerAuthorizationTest {
    private static final Clock CLOCK =
            Clock.fixed(Instant.parse("2026-07-19T10:06:00Z"), ZoneOffset.UTC);

    @Test
    void scopedRevenueManagerMayWriteMappingsButNotConnectorOrSimulationConfiguration() {
        UUID accountId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        AtomicBoolean handled = new AtomicBoolean();
        RecordingAudit audit = new RecordingAudit();
        PrivilegedTenantCommandExecutor executor = new PrivilegedTenantCommandExecutor(
                directTenantContext(),
                command -> {
                    handled.set(true);
                    return new TenantConfigurationCommandHandler.CommandReceipt("mapping", 1);
                },
                (candidateAccount, candidateHotel, scopeType) ->
                        candidateAccount.equals(accountId)
                                && candidateHotel.equals(hotelId)
                                && scopeType.equals("REVENUE_CONFIGURATION"),
                audit,
                CLOCK);
        TrustedAuthorizationContext revenueManager = context(accountId, OtaRole.REVENUE_MANAGER);
        Sprint1TenantCommand mapping = command(
                accountId,
                tenantId,
                new Sprint1Mutations.UpsertProductMapping(
                        hotelId, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID()));

        executor.execute(revenueManager, mapping, "scope-allowed");
        assertThat(handled).isTrue();
        assertThat(audit.inTransaction).hasSize(1);

        handled.set(false);
        Sprint1TenantCommand connector = command(
                accountId,
                tenantId,
                new Sprint1Mutations.UpsertConnector(
                        hotelId, UUID.randomUUID(), "MOCK_PMS", "PMS",
                        true, "BASELINE", 60, null));
        assertThatThrownBy(() -> executor.execute(revenueManager, connector, "connector-denied"))
                .isInstanceOf(SecurityException.class);
        assertThat(handled).isFalse();

        Sprint1TenantCommand simulation = command(
                accountId,
                tenantId,
                new Sprint1Mutations.TriggerSimulation(
                        hotelId, UUID.randomUUID(), "BASELINE"));
        assertThatThrownBy(() -> executor.execute(revenueManager, simulation, "simulation-denied"))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void revenueManagerWithoutExactHotelScopeIsDeniedInsideTenantRlsTransaction() {
        UUID accountId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        AtomicBoolean tenantTransactionEntered = new AtomicBoolean();
        AtomicBoolean handled = new AtomicBoolean();
        RecordingAudit audit = new RecordingAudit();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID candidateTenant, boolean readOnly,
                                  java.util.function.Supplier<T> work) {
                assertThat(candidateTenant).isEqualTo(tenantId);
                assertThat(readOnly).isFalse();
                tenantTransactionEntered.set(true);
                return work.get();
            }
        };
        PrivilegedTenantCommandExecutor executor = new PrivilegedTenantCommandExecutor(
                tenantContext,
                command -> {
                    handled.set(true);
                    return new TenantConfigurationCommandHandler.CommandReceipt("unexpected", 1);
                },
                (candidateAccount, candidateHotel, scopeType) -> false,
                audit,
                CLOCK);
        Sprint1TenantCommand command = command(
                accountId,
                tenantId,
                new Sprint1Mutations.UpsertInventoryPool(
                        hotelId, UUID.randomUUID(), "VIEW", "View", 10));

        assertThatThrownBy(() -> executor.execute(
                context(accountId, OtaRole.REVENUE_MANAGER), command, "scope-denied"))
                .isInstanceOf(SecurityException.class)
                .hasMessageContaining("hotel scope");
        assertThat(tenantTransactionEntered).isTrue();
        assertThat(handled).isFalse();
        assertThat(audit.independent.getLast().reasonCode()).isEqualTo("MISSING_HOTEL_SCOPE");
        assertThat(audit.independent.getLast().targetTenantId()).isNull();
        assertThat(audit.independent.getLast().targetHotelId()).isNull();
        assertThat(audit.independent.getLast().conditionHash()).isEqualTo("a".repeat(64));
    }

    private static Sprint1TenantCommand command(
            UUID accountId,
            UUID tenantId,
            Sprint1Mutations.Mutation mutation
    ) {
        return new Sprint1TenantCommand(
                tenantId,
                accountId,
                "idempotency-key-0001",
                0,
                "SIMULATION_CONFIG",
                "a".repeat(64),
                mutation);
    }

    private static TenantContextExecutor directTenantContext() {
        return new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID tenantId, boolean readOnly,
                                  java.util.function.Supplier<T> work) {
                return work.get();
            }
        };
    }

    private static TrustedAuthorizationContext context(UUID accountId, OtaRole role) {
        return TrustedAuthorizationContext.fromCurrentAccount(new LocalAccount(
                accountId, "account", "Account", AccountStatus.ACTIVE, 1, Set.of(role)));
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
