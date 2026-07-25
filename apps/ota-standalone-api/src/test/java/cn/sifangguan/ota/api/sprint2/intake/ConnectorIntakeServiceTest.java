package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.BlockedAction;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectorIntakeServiceTest {
    private RecordingPort port;
    private RecordingTenantContext tenants;
    private RecordingAudit audit;
    private ConnectorIntakeService service;
    private AccountView admin;

    @BeforeEach
    void setUp() {
        port = new RecordingPort();
        tenants = new RecordingTenantContext();
        audit = new RecordingAudit();
        service = new ConnectorIntakeService(
                new ConnectorIntakeTemplateDirectory(),
                port,
                tenants,
                audit,
                Clock.fixed(Instant.parse("2026-07-23T10:00:00Z"), ZoneOffset.UTC));
        admin = new AccountView(
                UUID.randomUUID(),
                "Admin",
                Set.of(OtaRole.PLATFORM_ADMIN));
    }

    @Test
    void savesDraftInsideOneTenantWriteContextWithIdempotencyAndSafeAuditHash() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        String secretReference = "vault://ota/pilot/ctrip/session";

        CommandReceipt receipt = service.saveDraft(
                admin,
                tenantId,
                hotelId,
                connectorId,
                4,
                "CONFIGURE_CTRIP",
                "connector-intake-0001",
                "CTRIP_INTAKE",
                SourceCode.CTRIP,
                "CTRIP",
                "携程",
                "携程商家后台",
                null,
                "CONTROLLED_BROWSER",
                "CTRIP_HOTEL_001",
                "hotel-account",
                "ROUTE_CTRIP",
                15,
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "VAULT",
                        secretReference,
                        "v1")),
                "correlation-0001");

        assertThat(receipt.resourceId()).isEqualTo(connectorId);
        assertThat(tenants.calls)
                .containsExactly(new TenantCall(tenantId, false));
        assertThat(port.saved).isNotNull();
        assertThat(port.saved.expectedRowVersion()).isEqualTo(4);
        assertThat(port.saved.idempotencyKey()).isEqualTo("connector-intake-0001");
        assertThat(port.saved.secretBindings().getFirst().opaqueSecretReference())
                .isEqualTo(secretReference);
        assertThat(port.saved.requestHash()).hasSize(64);
        assertThat(port.saved.requestHash()).doesNotContain(secretReference);
        assertThat(audit.events).hasSize(1);
        assertThat(audit.events.getFirst().outcome()).isEqualTo("SUCCEEDED");
        assertThat(audit.events.getFirst().conditionHash())
                .isEqualTo(port.saved.requestHash());
    }

    @Test
    void globalReadersCanReadButRevenueManagerCannotReadConnectorIntake() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        AccountView manager = new AccountView(
                UUID.randomUUID(),
                "Manager",
                Set.of(OtaRole.OTA_OPERATION_MANAGER));

        assertThat(service.listDrafts(manager, tenantId, hotelId)).isEmpty();
        assertThat(tenants.calls)
                .containsExactly(new TenantCall(tenantId, true));

        AccountView revenue = new AccountView(
                UUID.randomUUID(),
                "Revenue",
                Set.of(OtaRole.REVENUE_MANAGER));
        assertThatThrownBy(() -> service.listDrafts(revenue, tenantId, hotelId))
                .isInstanceOf(SecurityException.class);
    }

    @Test
    void updateMayOmitBindingsSoStorageCanRetainPreviousReferences() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();

        service.saveDraft(
                admin,
                tenantId,
                hotelId,
                connectorId,
                3,
                "UPDATE_CTRIP",
                "connector-intake-update-0001",
                "CTRIP_INTAKE",
                SourceCode.CTRIP,
                "CTRIP",
                "携程",
                "携程商家后台",
                null,
                "CONTROLLED_BROWSER",
                "CTRIP_HOTEL_001",
                "hotel-account",
                "ROUTE_CTRIP",
                15,
                List.of(),
                "correlation-update-0001");

        assertThat(port.saved.expectedRowVersion()).isEqualTo(3);
        assertThat(port.saved.secretBindings()).isEmpty();
    }

    @Test
    void nonAdminCannotWriteAndExternalActionsAreAlwaysBlockedForAdmin() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        AccountView operations = new AccountView(
                UUID.randomUUID(),
                "Operations",
                Set.of(OtaRole.OTA_OPERATION_MANAGER));

        assertThatThrownBy(() -> saveMinimal(
                operations,
                tenantId,
                hotelId,
                connectorId))
                .isInstanceOf(SecurityException.class);
        assertThat(port.saved).isNull();

        assertThatThrownBy(() -> service.rejectExternalAction(
                admin,
                tenantId,
                hotelId,
                connectorId,
                BlockedAction.ACTIVATE,
                "correlation-0002"))
                .isInstanceOf(Sprint2ExternalActionBlockedException.class);
        assertThat(audit.events)
                .extracting(AuditEvent::reasonCode)
                .contains("SPRINT2_EXTERNAL_ACTION_BLOCKED");
    }

    private void saveMinimal(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId
    ) {
        service.saveDraft(
                account,
                tenantId,
                hotelId,
                connectorId,
                0,
                "CONFIGURE_PMS",
                "connector-intake-0002",
                "PMS_INTAKE",
                SourceCode.PMS,
                "PMS_VENDOR",
                "PMS Vendor",
                "PMS",
                null,
                "OFFICIAL_API",
                "PMS_HOTEL_001",
                null,
                "ROUTE_PMS",
                5,
                List.of(new SecretBindingInput(
                        "SOURCE_AUTH",
                        "VAULT",
                        "vault://ota/pilot/pms/source-auth",
                        "v1")),
                "correlation-0003");
    }

    private static final class RecordingPort implements ConnectorIntakePort {
        private SaveDraftCommand saved;

        @Override
        public List<ConnectorDraftView> listDrafts(UUID hotelId) {
            return List.of();
        }

        @Override
        public Optional<ConnectorDraftView> findDraft(
                UUID hotelId,
                SourceCode sourceCode
        ) {
            return Optional.empty();
        }

        @Override
        public CommandReceipt saveDraft(SaveDraftCommand command) {
            saved = command;
            return new CommandReceipt(
                    "command-0001",
                    command.connectorId(),
                    command.expectedRowVersion() + 1,
                    false);
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

    private static final class RecordingAudit implements AuditPort {
        private final List<AuditEvent> events = new ArrayList<>();

        @Override
        public void append(AuditEvent event) {
            events.add(event);
        }

        @Override
        public void appendInCurrentTransaction(AuditEvent event) {
            events.add(event);
        }
    }
}
