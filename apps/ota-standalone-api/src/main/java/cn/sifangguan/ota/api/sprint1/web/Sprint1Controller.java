package cn.sifangguan.ota.api.sprint1.web;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import cn.sifangguan.ota.api.sprint1.application.Sprint1ControlPlaneService;
import cn.sifangguan.ota.api.sprint1.catalog.ConnectorAdapterDirectory;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.CrossTenantReadResult;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

@Validated
@RestController
@RequestMapping("/api/v1")
public class Sprint1Controller {
    private static final java.util.regex.Pattern SAFE_CORRELATION =
            java.util.regex.Pattern.compile("[A-Za-z0-9._:-]{1,128}");
    private final ConnectorAdapterDirectory adapters;
    private final Sprint1ControlPlaneService service;

    public Sprint1Controller(
            ConnectorAdapterDirectory adapters,
            Sprint1ControlPlaneService service
    ) {
        this.adapters = adapters;
        this.service = service;
    }

    @GetMapping("/ota/connector-adapters")
    public ResponseEntity<Sprint1Views.Envelope<List<ConnectorAdapterDirectory.AdapterSummary>>> adapters() {
        return noStore(new Sprint1Views.Envelope<>(adapters.list()));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.ConfigurationView>> configuration(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.configuration(account(authentication), tenantId, hotelId)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/monitor")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.MonitorView>> monitor(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.monitor(account(authentication), tenantId, hotelId)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/briefs")
    public ResponseEntity<Sprint1Views.Envelope<List<Sprint1Views.BriefView>>> briefs(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestParam(defaultValue = "24") @Min(1) @Max(100) int limit,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.briefs(account(authentication), tenantId, hotelId, limit)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/incidents")
    public ResponseEntity<Sprint1Views.Envelope<List<Sprint1Views.IncidentView>>> incidents(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.incidents(account(authentication), tenantId, hotelId, limit)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/outbox-preview")
    public ResponseEntity<Sprint1Views.Envelope<List<Sprint1Views.OutboxPreview>>> outboxPreview(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestParam(defaultValue = "50") @Min(1) @Max(100) int limit,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.outboxPreview(account(authentication), tenantId, hotelId, limit)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs")
    public ResponseEntity<Sprint1Views.Envelope<List<Sprint1Views.SimulationRunView>>> simulationRuns(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestParam(defaultValue = "20") @Min(1) @Max(100) int limit,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.simulationRuns(account(authentication), tenantId, hotelId, limit)));
    }

    @GetMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs/{runId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.SimulationRunView>> simulationRun(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID runId,
            Authentication authentication
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.simulationRun(account(authentication), tenantId, hotelId, runId)));
    }

    @GetMapping("/group/ota/monitor")
    public ResponseEntity<Sprint1Views.Envelope<CrossTenantReadResult<List<Sprint1Views.MonitorView>>>>
    groupMonitor(
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String correlationId = correlationId(request, response);
        return noStore(new Sprint1Views.Envelope<>(
                service.groupMonitor(account(authentication), correlationId)));
    }

    @GetMapping("/group/ota/briefs")
    public ResponseEntity<Sprint1Views.Envelope<CrossTenantReadResult<List<Sprint1Views.BriefView>>>>
    groupBriefs(
            @RequestParam(defaultValue = "100") @Min(1) @Max(100) int limit,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String correlationId = correlationId(request, response);
        return noStore(new Sprint1Views.Envelope<>(
                service.groupBriefs(account(authentication), limit, correlationId)));
    }

    @GetMapping("/group/ota/incidents")
    public ResponseEntity<Sprint1Views.Envelope<CrossTenantReadResult<List<Sprint1Views.IncidentView>>>>
    groupIncidents(
            @RequestParam(defaultValue = "100") @Min(1) @Max(100) int limit,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String correlationId = correlationId(request, response);
        return noStore(new Sprint1Views.Envelope<>(
                service.groupIncidents(account(authentication), limit, correlationId)));
    }

    @GetMapping("/ota/simulation/hotels")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.SimulationHotelDirectoryView>>
    simulationHotels(
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return noStore(new Sprint1Views.Envelope<>(
                service.simulationHotels(
                        account(authentication), correlationId(request, response))));
    }

    @PostMapping("/ota/simulation/hotels")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>>
    initializeSimulationHotel(
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody InitializeSimulationHotelRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        Sprint1Mutations.InitializeSimulationHotel mutation = service.newSimulationHotel(
                body.tenantCode(), body.tenantDisplayName(), body.hotelCode(),
                body.hotelDisplayName(), body.timezone(), idempotencyKey);
        return accepted(new Sprint1Views.Envelope<>(service.execute(
                account(authentication), mutation.tenantId(), body.expectedRowVersion(),
                body.reasonCode(), idempotencyKey, mutation, correlationId(request, response))));
    }

    @PostMapping("/ota/tenants/{tenantId}/configuration")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertTenant(
            @PathVariable UUID tenantId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody TenantRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertTenant(
                tenantId, body.tenantCode(), body.displayName(), body.timezone(), body.status());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/hotel")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertHotel(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody HotelRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertHotel(
                hotelId, body.hotelCode(), body.displayName(), body.timezone(),
                body.lifecycleStatus(), body.collectionEnabled(), body.messageEnabled());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/connectors/{connectorId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertConnector(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID connectorId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody ConnectorRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        adapters.require(body.adapterCode());
        var mutation = new Sprint1Mutations.UpsertConnector(
                hotelId, connectorId, body.adapterCode(), body.sourceCode(), body.enabled(),
                body.fixtureScenarioCode(), body.pollIntervalMinutes(), body.secretReference());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/inventory-pools/{poolId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertInventoryPool(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID poolId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody InventoryPoolRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertInventoryPool(
                hotelId, poolId, body.physicalRoomTypeCode(), body.displayName(),
                body.physicalRoomCount());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/products/{productId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertProduct(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID productId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody ProductRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertSellableProduct(
                hotelId, productId, body.connectorId(), body.sourceCode(),
                body.externalProductCode(), body.displayName(), body.mealPlanCode());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/product-mappings/{mappingId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertProductMapping(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID mappingId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody ProductMappingRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertProductMapping(
                hotelId, mappingId, body.productId(), body.inventoryPoolId());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/targets/{targetId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertTarget(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID targetId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody TargetRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        var mutation = new Sprint1Mutations.UpsertRevenueTarget(
                hotelId, targetId, body.businessDate(), body.roomRevenueTarget(), body.targetAdr());
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/pace-curves/{curveId}")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> upsertPaceCurve(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @PathVariable UUID curveId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody PaceCurveRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        List<Sprint1Mutations.PacePointInput> points = body.points().stream()
                .map(point -> new Sprint1Mutations.PacePointInput(
                        point.cutoffLocalTime(), point.revenueProgressPercent(), point.soldProgressPercent()))
                .toList();
        var mutation = new Sprint1Mutations.UpsertPaceCurve(
                hotelId, curveId, body.curveCode(), body.validFrom(), body.validUntil(), points);
        return command(authentication, tenantId, idempotencyKey, body, mutation, request, response);
    }

    @PostMapping("/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs")
    public ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> triggerSimulation(
            @PathVariable UUID tenantId,
            @PathVariable UUID hotelId,
            @RequestHeader("Idempotency-Key") @Size(min = 8, max = 200)
            @Pattern(regexp = "[A-Za-z0-9._:-]+") String idempotencyKey,
            @Valid @RequestBody SimulationRunRequest body,
            Authentication authentication,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        if (body.expectedRowVersion() != 0) {
            throw new IllegalArgumentException("New simulation runs require expectedRowVersion=0");
        }
        UUID runId = service.deterministicSimulationRunId(tenantId, hotelId, idempotencyKey);
        var mutation = new Sprint1Mutations.TriggerSimulation(hotelId, runId, body.scenarioCode());
        return accepted(new Sprint1Views.Envelope<>(service.execute(
                account(authentication), tenantId, body.expectedRowVersion(), body.reasonCode(),
                idempotencyKey, mutation, correlationId(request, response))));
    }

    private ResponseEntity<Sprint1Views.Envelope<Sprint1Views.CommandReceipt>> command(
            Authentication authentication,
            UUID tenantId,
            String idempotencyKey,
            CommandRequest body,
            Sprint1Mutations.Mutation mutation,
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        return noStore(new Sprint1Views.Envelope<>(service.execute(
                account(authentication), tenantId, body.expectedRowVersion(), body.reasonCode(),
                idempotencyKey, mutation, correlationId(request, response))));
    }

    private static AccountView account(Authentication authentication) {
        if (authentication == null
                || !(authentication.getPrincipal() instanceof AuthenticatedAccountPrincipal principal)) {
            throw new SecurityException("Authenticated account is required");
        }
        return principal.account();
    }

    private static String correlationId(
            HttpServletRequest request,
            HttpServletResponse response
    ) {
        String candidate = request.getHeader("X-Correlation-ID");
        String value = candidate != null && SAFE_CORRELATION.matcher(candidate).matches()
                ? candidate : UUID.randomUUID().toString();
        response.setHeader("X-Correlation-ID", value);
        return value;
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    private static <T> ResponseEntity<T> accepted(T body) {
        return ResponseEntity.accepted()
                .cacheControl(CacheControl.noStore())
                .body(body);
    }

    public interface CommandRequest {
        long expectedRowVersion();

        String reasonCode();
    }

    public record TenantRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String tenantCode,
            @NotBlank @Size(max = 160) String displayName,
            @NotBlank @Size(max = 64) String timezone,
            @NotBlank @Size(max = 24) String status
    ) implements CommandRequest {
    }

    public record HotelRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String hotelCode,
            @NotBlank @Size(max = 160) String displayName,
            @NotBlank @Size(max = 64) String timezone,
            @NotBlank @Size(max = 24) String lifecycleStatus,
            boolean collectionEnabled,
            boolean messageEnabled
    ) implements CommandRequest {
    }

    public record ConnectorRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 32) String adapterCode,
            @NotBlank @Size(max = 32) String sourceCode,
            boolean enabled,
            @NotBlank @Size(max = 64) String fixtureScenarioCode,
            @Min(5) @Max(60) int pollIntervalMinutes,
            @Size(max = 256) String secretReference
    ) implements CommandRequest {
    }

    public record InventoryPoolRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String physicalRoomTypeCode,
            @NotBlank @Size(max = 160) String displayName,
            @Min(1) @Max(10000) int physicalRoomCount
    ) implements CommandRequest {
    }

    public record ProductRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotNull UUID connectorId,
            @NotBlank @Size(max = 32) String sourceCode,
            @NotBlank @Size(max = 64) String externalProductCode,
            @NotBlank @Size(max = 160) String displayName,
            @NotBlank @Size(max = 32) String mealPlanCode
    ) implements CommandRequest {
    }

    public record ProductMappingRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotNull UUID productId,
            @NotNull UUID inventoryPoolId
    ) implements CommandRequest {
    }

    public record TargetRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotNull LocalDate businessDate,
            @NotNull BigDecimal roomRevenueTarget,
            @NotNull BigDecimal targetAdr
    ) implements CommandRequest {
    }

    public record PacePointRequest(
            @NotNull LocalTime cutoffLocalTime,
            @NotNull BigDecimal revenueProgressPercent,
            @NotNull BigDecimal soldProgressPercent
    ) {
    }

    public record PaceCurveRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String curveCode,
            @NotNull LocalDate validFrom,
            LocalDate validUntil,
            @NotNull @Size(min = 2, max = 24) List<@Valid PacePointRequest> points
    ) implements CommandRequest {
    }

    public record SimulationRunRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String scenarioCode
    ) implements CommandRequest {
    }

    public record InitializeSimulationHotelRequest(
            @Min(0) long expectedRowVersion,
            @NotBlank @Pattern(regexp = "[A-Z][A-Z0-9_]{2,63}") String reasonCode,
            @NotBlank @Size(max = 64) String tenantCode,
            @NotBlank @Size(max = 160) String tenantDisplayName,
            @NotBlank @Size(max = 64) String hotelCode,
            @NotBlank @Size(max = 160) String hotelDisplayName,
            @NotBlank @Size(max = 64) String timezone
    ) {
    }
}
