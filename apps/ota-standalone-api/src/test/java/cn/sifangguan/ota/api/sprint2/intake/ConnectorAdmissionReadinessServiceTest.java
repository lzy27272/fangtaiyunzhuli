package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectorAdmissionReadinessServiceTest {
    private static final EnumSet<OtaRole> GLOBAL_READERS = EnumSet.of(
            OtaRole.PLATFORM_ADMIN,
            OtaRole.OTA_OPERATION_ASSISTANT,
            OtaRole.OTA_OPERATION_MANAGER,
            OtaRole.CEO,
            OtaRole.REGIONAL_MANAGER);

    @Test
    void exactlyFiveGlobalRolesCanReadInsideReadOnlyTenantContext() {
        RecordingPort port = new RecordingPort();
        RecordingTenantContext tenants = new RecordingTenantContext();
        ConnectorAdmissionReadinessService service =
                new ConnectorAdmissionReadinessService(port, tenants);
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();

        for (OtaRole role : GLOBAL_READERS) {
            AccountView account = new AccountView(
                    UUID.randomUUID(),
                    role.name(),
                    EnumSet.of(role));
            assertThat(service.listReadiness(account, tenantId, hotelId))
                    .isEmpty();
        }

        assertThat(tenants.calls).hasSize(5);
        assertThat(tenants.calls)
                .allMatch(call -> call.tenantId().equals(tenantId)
                        && call.readOnly());
        assertThat(port.hotelIds).containsOnly(hotelId);
    }

    @Test
    void hotelScopedRolesCannotReadAdmissionReadiness() {
        ConnectorAdmissionReadinessService service =
                new ConnectorAdmissionReadinessService(
                        hotelId -> List.of(),
                        new RecordingTenantContext());
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();

        for (OtaRole role : List.of(
                OtaRole.REVENUE_MANAGER,
                OtaRole.HOTEL_P1_HANDLER)) {
            AccountView account = new AccountView(
                    UUID.randomUUID(),
                    role.name(),
                    EnumSet.of(role));
            assertThatThrownBy(() ->
                    service.listReadiness(account, tenantId, hotelId))
                    .isInstanceOf(SecurityException.class);
        }
    }

    private static final class RecordingPort
            implements ConnectorAdmissionReadinessPort {
        private final List<UUID> hotelIds = new ArrayList<>();

        @Override
        public List<ConnectorContractAdmissionView> listReadiness(
                UUID hotelId
        ) {
            hotelIds.add(hotelId);
            return List.of();
        }
    }

    private static final class RecordingTenantContext
            implements TenantContextExecutor {
        private final List<TenantCall> calls = new ArrayList<>();

        @Override
        public <T> T inTenant(
                UUID tenantId,
                boolean readOnly,
                Supplier<T> work
        ) {
            calls.add(new TenantCall(tenantId, readOnly));
            return work.get();
        }
    }

    private record TenantCall(UUID tenantId, boolean readOnly) {
    }
}
