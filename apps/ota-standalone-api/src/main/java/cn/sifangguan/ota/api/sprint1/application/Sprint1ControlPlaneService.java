package cn.sifangguan.ota.api.sprint1.application;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.api.sprint1.config.Sprint1SafetyGate;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.CrossTenantReadExecutor;
import cn.sifangguan.ota.api.tenancy.CrossTenantReadResult;
import cn.sifangguan.ota.api.tenancy.PrivilegedTenantCommandExecutor;
import cn.sifangguan.ota.api.tenancy.Sprint1TenantCommand;
import cn.sifangguan.ota.api.tenancy.TenantConfigurationCommandHandler;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Supplier;

public final class Sprint1ControlPlaneService {
    private static final int MAX_PAGE_SIZE = 100;
    private final Sprint1ControlPlanePort port;
    private final TenantContextExecutor tenants;
    private final PrivilegedTenantCommandExecutor commands;
    private final CrossTenantReadExecutor crossTenantReads;
    private final Sprint1SafetyGate safety;

    public Sprint1ControlPlaneService(
            Sprint1ControlPlanePort port,
            TenantContextExecutor tenants,
            PrivilegedTenantCommandExecutor commands,
            CrossTenantReadExecutor crossTenantReads,
            Sprint1SafetyGate safety
    ) {
        this.port = port;
        this.tenants = tenants;
        this.commands = commands;
        this.crossTenantReads = crossTenantReads;
        this.safety = safety;
    }

    public Sprint1Views.ConfigurationView configuration(
            AccountView account,
            UUID tenantId,
            UUID hotelId
    ) {
        Sprint1Views.ConfigurationView configuration =
                readHotel(account, tenantId, hotelId, ReadKind.REVENUE_CONFIGURATION,
                () -> port.findConfiguration(tenantId, hotelId)
                        .orElseThrow(() -> notFound("Hotel configuration")));
        return hasGlobalRead(account)
                ? configuration
                : revenueConfiguration(configuration);
    }

    public Sprint1Views.MonitorView monitor(AccountView account, UUID tenantId, UUID hotelId) {
        return readHotel(account, tenantId, hotelId, ReadKind.OPERATIONS,
                () -> port.findMonitor(tenantId, hotelId)
                        .orElseThrow(() -> notFound("Hotel monitor")));
    }

    public List<Sprint1Views.BriefView> briefs(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            int limit
    ) {
        return readHotel(account, tenantId, hotelId, ReadKind.OPERATIONS,
                () -> port.listBriefs(hotelId, pageSize(limit)));
    }

    public List<Sprint1Views.IncidentView> incidents(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            int limit
    ) {
        return readHotel(account, tenantId, hotelId, ReadKind.INCIDENTS,
                () -> port.listIncidents(hotelId, pageSize(limit)));
    }

    public List<Sprint1Views.OutboxPreview> outboxPreview(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            int limit
    ) {
        return readHotel(account, tenantId, hotelId, ReadKind.OPERATIONS,
                () -> port.listOutboxPreview(hotelId, pageSize(limit)));
    }

    public List<Sprint1Views.SimulationRunView> simulationRuns(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            int limit
    ) {
        return readHotel(account, tenantId, hotelId, ReadKind.OPERATIONS,
                () -> port.listSimulationRuns(hotelId, pageSize(limit)));
    }

    public Sprint1Views.SimulationRunView simulationRun(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID runId
    ) {
        return readHotel(account, tenantId, hotelId, ReadKind.OPERATIONS,
                () -> port.findSimulationRun(hotelId, runId)
                        .orElseThrow(() -> notFound("Simulation run")));
    }

    public CrossTenantReadResult<List<Sprint1Views.MonitorView>> groupMonitor(
            AccountView account,
            String correlationId
    ) {
        return crossTenantReads.read(authorize(account), ignored ->
                port.listHotelIds().stream()
                        .map(hotelId -> port.findMonitor(ignored, hotelId))
                        .flatMap(java.util.Optional::stream)
                        .toList(), correlationId);
    }

    public CrossTenantReadResult<List<Sprint1Views.BriefView>> groupBriefs(
            AccountView account,
            int limit,
            String correlationId
    ) {
        int bounded = pageSize(limit);
        return crossTenantReads.read(authorize(account), ignored ->
                port.listHotelIds().stream()
                        .flatMap(hotelId -> port.listBriefs(hotelId, bounded).stream())
                        .sorted(java.util.Comparator.comparing(
                                Sprint1Views.BriefView::cutoffAt,
                                java.util.Comparator.nullsLast(java.util.Comparator.reverseOrder())))
                        .limit(bounded)
                        .toList(), correlationId);
    }

    public CrossTenantReadResult<List<Sprint1Views.IncidentView>> groupIncidents(
            AccountView account,
            int limit,
            String correlationId
    ) {
        int bounded = pageSize(limit);
        return crossTenantReads.read(authorize(account), ignored ->
                port.listHotelIds().stream()
                        .flatMap(hotelId -> port.listIncidents(hotelId, bounded).stream())
                        .sorted(java.util.Comparator.comparing(
                                Sprint1Views.IncidentView::openedAt,
                                java.util.Comparator.reverseOrder()))
                        .limit(bounded)
                        .toList(), correlationId);
    }

    public Sprint1Views.SimulationHotelDirectoryView simulationHotels(
            AccountView account,
            String correlationId
    ) {
        CrossTenantReadResult<List<Sprint1Views.SimulationHotelView>> result =
                crossTenantReads.read(authorize(account), ignored -> port.listSimulationHotels(), correlationId);
        List<Sprint1Views.SimulationHotelView> hotels = result.values().values().stream()
                .flatMap(List::stream)
                .sorted(java.util.Comparator.comparing(Sprint1Views.SimulationHotelView::hotelName))
                .toList();
        return new Sprint1Views.SimulationHotelDirectoryView(
                result.coverage().name(),
                hotels,
                result.failures().stream()
                        .map(CrossTenantReadResult.TenantFailure::tenantId)
                        .toList());
    }

    public Sprint1Views.CommandReceipt execute(
            AccountView account,
            UUID tenantId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            Sprint1Mutations.Mutation mutation,
            String correlationId
    ) {
        Objects.requireNonNull(mutation, "mutation");
        if (mutation instanceof Sprint1Mutations.TriggerSimulation
                || mutation instanceof Sprint1Mutations.InitializeSimulationHotel) {
            safety.requireSimulationTriggerAllowed();
        }
        String requestHash = sha256(String.join("\n",
                tenantId.toString(),
                Long.toString(expectedRowVersion),
                reasonCode,
                mutation.canonicalForm()));
        Sprint1TenantCommand command = new Sprint1TenantCommand(
                tenantId, account.id(), idempotencyKey, expectedRowVersion,
                reasonCode, requestHash, mutation);
        TenantConfigurationCommandHandler.CommandReceipt receipt =
                commands.execute(authorize(account), command, correlationId);
        return new Sprint1Views.CommandReceipt(
                receipt.commandId(), mutation.resourceId(), receipt.resultingRowVersion(), receipt.replayed());
    }

    public UUID deterministicSimulationRunId(UUID tenantId, UUID hotelId, String idempotencyKey) {
        String stable = String.join("|", "SIMULATION_RUN", tenantId.toString(),
                hotelId.toString(), idempotencyKey);
        return UUID.nameUUIDFromBytes(stable.getBytes(StandardCharsets.UTF_8));
    }

    public Sprint1Mutations.InitializeSimulationHotel newSimulationHotel(
            String tenantCode,
            String tenantDisplayName,
            String hotelCode,
            String hotelDisplayName,
            String timezone,
            String idempotencyKey
    ) {
        UUID tenantId = stableId("SIM_TENANT", tenantCode);
        UUID hotelId = stableId("SIM_HOTEL", tenantCode, hotelCode);
        return new Sprint1Mutations.InitializeSimulationHotel(
                tenantId,
                hotelId,
                stableId("SIM_CONNECTOR_PMS", hotelId.toString()),
                stableId("SIM_CONNECTOR_CTRIP", hotelId.toString()),
                stableId("SIM_CONNECTOR_MEITUAN", hotelId.toString()),
                tenantCode,
                tenantDisplayName,
                hotelCode,
                hotelDisplayName,
                timezone);
    }

    private <T> T readHotel(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            ReadKind kind,
            Supplier<T> read
    ) {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        return tenants.inTenant(tenantId, true, () -> {
            if (!hasGlobalRead(account) && !hasScopedRead(account, hotelId, kind)) {
                throw new SecurityException("Hotel read scope is required");
            }
            return read.get();
        });
    }

    private boolean hasScopedRead(AccountView account, UUID hotelId, ReadKind kind) {
        if (kind == ReadKind.INCIDENTS && account.roles().contains(OtaRole.HOTEL_P1_HANDLER)) {
            return port.hasHotelScope(account.id(), hotelId, "P1_HANDLING");
        }
        if (kind == ReadKind.REVENUE_CONFIGURATION
                && account.roles().stream().anyMatch(role -> switch (role) {
                    case GENERAL_MANAGER, ASSISTANT_GENERAL_MANAGER, FRONT_OFFICE_SUPERVISOR -> true;
                    default -> false;
                })) {
            return port.hasHotelScope(account.id(), hotelId, "PRICE_PREVIEW");
        }
        return false;
    }

    private static Sprint1Views.ConfigurationView revenueConfiguration(
            Sprint1Views.ConfigurationView configuration
    ) {
        return new Sprint1Views.ConfigurationView(
                configuration.tenant(),
                configuration.hotel(),
                List.of(),
                configuration.inventoryPools(),
                configuration.products(),
                configuration.productMappings(),
                configuration.targets(),
                configuration.paceCurves(),
                configuration.simulationMode(),
                configuration.outboundDeliveryBlocked());
    }

    private static boolean hasGlobalRead(AccountView account) {
        return account.roles().stream().anyMatch(OtaRole::hasGlobalReadAccess);
    }

    private static TrustedAuthorizationContext authorize(AccountView account) {
        return TrustedAuthorizationContext.fromAuthenticatedAccount(account);
    }

    private static Sprint1ResourceNotFoundException notFound(String type) {
        return new Sprint1ResourceNotFoundException(type + " was not found");
    }

    private static int pageSize(int requested) {
        if (requested < 1 || requested > MAX_PAGE_SIZE) {
            throw new IllegalArgumentException("limit must be between 1 and " + MAX_PAGE_SIZE);
        }
        return requested;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static UUID stableId(String... parts) {
        return UUID.nameUUIDFromBytes(String.join("|", parts).getBytes(StandardCharsets.UTF_8));
    }

    private enum ReadKind {
        REVENUE_CONFIGURATION,
        OPERATIONS,
        INCIDENTS
    }
}
