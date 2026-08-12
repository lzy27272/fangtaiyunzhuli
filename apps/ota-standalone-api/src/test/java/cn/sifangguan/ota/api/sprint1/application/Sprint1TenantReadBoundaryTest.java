package cn.sifangguan.ota.api.sprint1.application;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class Sprint1TenantReadBoundaryTest {
    @Test
    void globalReadStillUsesOneReadOnlyRlsTransactionForTheRequestedTenant() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        AtomicBoolean entered = new AtomicBoolean();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID candidate, boolean readOnly,
                                  java.util.function.Supplier<T> work) {
                assertThat(candidate).isEqualTo(tenantId);
                assertThat(readOnly).isTrue();
                entered.set(true);
                return work.get();
            }
        };
        Sprint1ControlPlanePort port = mock(Sprint1ControlPlanePort.class);
        Sprint1Views.ConfigurationView view = configuration(tenantId, hotelId);
        when(port.findConfiguration(tenantId, hotelId)).thenReturn(Optional.of(view));
        Sprint1ControlPlaneService service = new Sprint1ControlPlaneService(
                port, tenantContext, null, null, null);

        assertThat(service.configuration(
                new AccountView(UUID.randomUUID(), "CEO", Set.of(OtaRole.CEO)),
                tenantId,
                hotelId)).isSameAs(view);
        assertThat(entered).isTrue();
    }

    @Test
    void unsupportedLegacyRevenueManagerCannotReadAnUnscopedHotelOrUseGlobalRead() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID candidate, boolean readOnly,
                                  java.util.function.Supplier<T> work) {
                return work.get();
            }
        };
        Sprint1ControlPlanePort port = mock(Sprint1ControlPlanePort.class);
        when(port.hasHotelScope(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.eq(hotelId),
                org.mockito.ArgumentMatchers.eq("REVENUE_CONFIGURATION")))
                .thenReturn(false);
        Sprint1ControlPlaneService service = new Sprint1ControlPlaneService(
                port, tenantContext, null, null, null);

        assertThatThrownBy(() -> service.configuration(
                new AccountView(
                        UUID.randomUUID(), "Revenue", Set.of(OtaRole.REVENUE_MANAGER)),
                tenantId,
                hotelId))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void scopedHotelManagerReceivesOnlyPreviewInputsAndNoOperationsReads() {
        UUID accountId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        TenantContextExecutor tenantContext = new TenantContextExecutor() {
            @Override
            public <T> T inTenant(UUID candidate, boolean readOnly,
                                  java.util.function.Supplier<T> work) {
                assertThat(candidate).isEqualTo(tenantId);
                assertThat(readOnly).isTrue();
                return work.get();
            }
        };
        Sprint1ControlPlanePort port = mock(Sprint1ControlPlanePort.class);
        Sprint1Views.ConfigurationView full = configuration(tenantId, hotelId);
        when(port.findConfiguration(tenantId, hotelId)).thenReturn(Optional.of(full));
        when(port.hasHotelScope(accountId, hotelId, "PRICE_PREVIEW"))
                .thenReturn(true);
        Sprint1ControlPlaneService service = new Sprint1ControlPlaneService(
                port, tenantContext, null, null, null);
        AccountView account = new AccountView(
                accountId, "Hotel manager", Set.of(OtaRole.GENERAL_MANAGER));

        Sprint1Views.ConfigurationView scoped =
                service.configuration(account, tenantId, hotelId);

        assertThat(scoped.connectors()).isEmpty();
        assertThat(scoped.inventoryPools()).isEqualTo(full.inventoryPools());
        assertThat(scoped.products()).isEqualTo(full.products());
        assertThat(scoped.productMappings()).isEqualTo(full.productMappings());
        assertThat(scoped.targets()).isEqualTo(full.targets());
        assertThat(scoped.paceCurves()).isEqualTo(full.paceCurves());
        assertThatThrownBy(() -> service.monitor(account, tenantId, hotelId))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service.briefs(account, tenantId, hotelId, 10))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service.incidents(account, tenantId, hotelId, 10))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service.outboxPreview(account, tenantId, hotelId, 10))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service.simulationRuns(account, tenantId, hotelId, 10))
                .isInstanceOf(SecurityException.class);
        assertThatThrownBy(() -> service.simulationRun(
                account, tenantId, hotelId, UUID.randomUUID()))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void simulationResourceIdsDependOnlyOnBusinessKeysAndNotIdempotencyKey() {
        Sprint1ControlPlaneService service = new Sprint1ControlPlaneService(
                null, null, null, null, null);

        Sprint1Mutations.InitializeSimulationHotel firstHotel = service.newSimulationHotel(
                "TENANT-A", "Tenant A", "HOTEL-ONE", "Hotel One",
                "Asia/Shanghai", "request-key-one");
        Sprint1Mutations.InitializeSimulationHotel secondHotel = service.newSimulationHotel(
                "TENANT-A", "Tenant A", "HOTEL-TWO", "Hotel Two",
                "Asia/Shanghai", "request-key-two");
        Sprint1Mutations.InitializeSimulationHotel repeatedHotel = service.newSimulationHotel(
                "TENANT-A", "Tenant A renamed", "HOTEL-ONE", "Hotel One renamed",
                "Asia/Shanghai", "request-key-three");

        assertThat(secondHotel.tenantId()).isEqualTo(firstHotel.tenantId());
        assertThat(secondHotel.hotelId()).isNotEqualTo(firstHotel.hotelId());
        assertThat(repeatedHotel.tenantId()).isEqualTo(firstHotel.tenantId());
        assertThat(repeatedHotel.hotelId()).isEqualTo(firstHotel.hotelId());
    }

    private static Sprint1Views.ConfigurationView configuration(UUID tenantId, UUID hotelId) {
        return new Sprint1Views.ConfigurationView(
                new Sprint1Views.TenantView(
                        tenantId, "TENANT", "Tenant", "Asia/Shanghai", "ACTIVE", 0),
                new Sprint1Views.HotelView(
                        tenantId, hotelId, "HOTEL", "Hotel", "Asia/Shanghai",
                        "READY_FOR_TEST", true, false, 0),
                List.of(new Sprint1Views.ConnectorView(
                        UUID.randomUUID(), "MOCK_PMS", "PMS", true,
                        "BASELINE", 60, 0,
                        new Sprint1Views.SecretReferenceStatus(
                                false, "", "NOT_REQUIRED", null))),
                List.of(), List.of(), List.of(), List.of(), List.of(), true, true);
    }
}
