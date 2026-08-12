package cn.sifangguan.ota.api.sprint2.migration;

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
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class CredentialMigrationServiceTest {
    private RecordingPort port;
    private RecordingTenantContext tenants;
    private RecordingAudit audit;
    private CredentialMigrationService service;
    private AccountView admin;

    @BeforeEach
    void setUp() {
        port = new RecordingPort();
        tenants = new RecordingTenantContext();
        audit = new RecordingAudit();
        service = new CredentialMigrationService(
                port,
                tenants,
                audit,
                Clock.fixed(
                        Instant.parse("2026-08-11T16:00:00Z"),
                        ZoneOffset.UTC));
        admin = new AccountView(
                UUID.randomUUID(),
                "Admin",
                Set.of(OtaRole.PLATFORM_ADMIN));
    }

    @Test
    void preparesOnlyHashedMetadataInsideOneTenantWriteTransaction() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        String locatorHash = "a".repeat(64);
        String targetFingerprint = "sha256:" + "b".repeat(64);

        Receipt receipt = service.prepare(
                admin,
                tenantId,
                hotelId,
                connectorId,
                versionId,
                3,
                "SOURCE_AUTH",
                "LEGACY_CLOUD_SERVICE",
                locatorHash,
                "VAULT",
                "v2",
                targetFingerprint,
                "PREPARE_METADATA_REHEARSAL",
                "credential-migration-0001",
                "correlation-0001");

        assertThat(receipt.rehearsalId()).isNotNull();
        assertThat(tenants.calls)
                .containsExactly(new TenantCall(tenantId, false));
        assertThat(port.command.sourceLocatorHash()).isEqualTo(locatorHash);
        assertThat(port.command.targetSecretFingerprint())
                .isEqualTo(targetFingerprint);
        assertThat(port.command.requestHash())
                .matches("[a-f0-9]{64}")
                .doesNotContain(locatorHash, targetFingerprint);
        assertThat(audit.events).hasSize(1);
        assertThat(audit.events.getFirst().outcome()).isEqualTo("SUCCEEDED");
        assertThat(audit.events.getFirst().conditionHash())
                .isEqualTo(port.command.requestHash());
    }

    @Test
    void rejectsRawLegacyLocatorAndNonAdminBeforePersistence() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        AccountView operations = new AccountView(
                UUID.randomUUID(),
                "Operations",
                Set.of(OtaRole.OTA_OPERATION_MANAGER));

        assertThatThrownBy(() -> service.prepare(
                admin,
                tenantId,
                hotelId,
                connectorId,
                versionId,
                0,
                "SOURCE_AUTH",
                "LEGACY_CLOUD_SERVICE",
                "C:/legacy/config.json",
                "VAULT",
                "v1",
                "sha256:" + "b".repeat(64),
                "PREPARE_METADATA_REHEARSAL",
                "credential-migration-0002",
                "correlation-0002"))
                .isInstanceOf(IllegalArgumentException.class);

        assertThatThrownBy(() -> service.prepare(
                operations,
                tenantId,
                hotelId,
                connectorId,
                versionId,
                0,
                "SOURCE_AUTH",
                "LEGACY_CLOUD_SERVICE",
                "a".repeat(64),
                "VAULT",
                "v1",
                "sha256:" + "b".repeat(64),
                "PREPARE_METADATA_REHEARSAL",
                "credential-migration-0003",
                "correlation-0003"))
                .isInstanceOf(SecurityException.class);

        assertThat(port.command).isNull();
        assertThat(audit.events)
                .extracting(AuditEvent::reasonCode)
                .containsExactly("MISSING_MIGRATION_PREP_PERMISSION");
    }

    @Test
    void globalReaderCanListButLegacyRevenueRoleCannot() {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        AccountView manager = new AccountView(
                UUID.randomUUID(),
                "Manager",
                Set.of(OtaRole.OTA_OPERATION_MANAGER));

        assertThat(service.list(manager, tenantId, hotelId, connectorId))
                .isEmpty();
        assertThat(tenants.calls)
                .containsExactly(new TenantCall(tenantId, true));

        AccountView legacy = new AccountView(
                UUID.randomUUID(),
                "Legacy",
                Set.of(OtaRole.REVENUE_MANAGER));
        assertThatThrownBy(() ->
                service.list(legacy, tenantId, hotelId, connectorId))
                .isInstanceOf(SecurityException.class);
    }

    private static final class RecordingPort implements CredentialMigrationPort {
        private PrepareCommand command;

        @Override
        public List<RehearsalView> list(UUID hotelId, UUID connectorId) {
            return List.of();
        }

        @Override
        public Receipt prepare(PrepareCommand value) {
            command = value;
            return new Receipt(
                    "command-0001",
                    UUID.randomUUID(),
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
