package cn.sifangguan.ota.api.sprint1.adapter;

import cn.sifangguan.ota.api.sprint1.application.IdempotencyConflictException;
import cn.sifangguan.ota.api.sprint1.application.RowVersionConflictException;
import cn.sifangguan.ota.api.sprint1.application.Sprint1ControlPlanePort;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.HotelScopeAuthorizationPort;
import cn.sifangguan.ota.api.tenancy.Sprint1TenantCommand;
import cn.sifangguan.ota.api.tenancy.TenantConfigurationCommand;
import cn.sifangguan.ota.api.tenancy.TenantConfigurationCommandHandler;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Fixed-SQL PostgreSQL adapter for the Sprint 1 control plane. Every method is
 * called inside a transaction-scoped RLS tenant context, except the narrow
 * server-owned tenant directory enumeration and controlled tenant creation
 * function.
 */
public final class JdbcSprint1ControlPlanePort
        implements Sprint1ControlPlanePort, HotelScopeAuthorizationPort {
    static final LocalDate SIMULATION_BUSINESS_DATE = LocalDate.of(2026, 7, 19);
    static final Instant SIMULATION_EXECUTION_CLOCK = Instant.parse("2026-07-19T10:06:00Z");
    static final Instant SIMULATION_CUTOFF = Instant.parse("2026-07-19T10:00:00Z");
    private static final List<ProductTemplate> SIMULATION_PRODUCT_TEMPLATES = List.of(
            new ProductTemplate("PMS", "PMS-VIEW-TWIN", "VIEW", "PMS_PHYSICAL_ROOM", null),
            new ProductTemplate("PMS", "PMS-LUX-KING", "LUX", "PMS_PHYSICAL_ROOM", null),
            new ProductTemplate("PMS", "PMS-ELEGANT-TWIN", "ELEGANT", "PMS_PHYSICAL_ROOM", null),
            new ProductTemplate("PMS", "PMS-FAMILY", "FAMILY", "PMS_PHYSICAL_ROOM", null),
            new ProductTemplate("PMS", "PMS-STANDARD", "STANDARD", "PMS_PHYSICAL_ROOM", null),
            new ProductTemplate("CTRIP", "CT-VIEW-NO-BREAKFAST", "VIEW", "OTA_SELL_PRODUCT", "ROOM_ONLY"),
            new ProductTemplate("CTRIP", "CT-VIEW-BREAKFAST", "VIEW", "OTA_SELL_PRODUCT", "BREAKFAST_INCLUDED"),
            new ProductTemplate("CTRIP", "CT-LUX-NO-BREAKFAST", "LUX", "OTA_SELL_PRODUCT", "ROOM_ONLY"),
            new ProductTemplate("CTRIP", "CT-STANDARD-NO-BREAKFAST", "STANDARD", "OTA_SELL_PRODUCT", "ROOM_ONLY"),
            new ProductTemplate("MEITUAN", "MT-LUX-BREAKFAST", "LUX", "OTA_SELL_PRODUCT", "BREAKFAST_INCLUDED"),
            new ProductTemplate("MEITUAN", "MT-STANDARD-NO-BREAKFAST", "STANDARD", "OTA_SELL_PRODUCT", "ROOM_ONLY"),
            new ProductTemplate("MEITUAN", "MT-ELEGANT", "ELEGANT", "OTA_SELL_PRODUCT", "ROOM_ONLY"));
    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public JdbcSprint1ControlPlanePort(JdbcTemplate jdbc, ObjectMapper objectMapper, Clock clock) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    public List<UUID> listEnabledTenantIds() {
        return jdbc.query("""
                        select tenant_id
                          from control.tenant_directory
                         where status in ('DRAFT', 'ACTIVE')
                         order by tenant_id
                        """,
                (resultSet, rowNumber) -> resultSet.getObject("tenant_id", UUID.class));
    }

    @Override
    public Optional<Sprint1Views.TenantView> findTenant(UUID tenantId) {
        return one("""
                        select tenant_id, tenant_code, display_name, default_timezone,
                               status, row_version
                          from control.tenant_directory
                         where tenant_id = ?
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.TenantView(
                        resultSet.getObject("tenant_id", UUID.class),
                        resultSet.getString("tenant_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("default_timezone"),
                        resultSet.getString("status"),
                        resultSet.getLong("row_version")),
                tenantId);
    }

    @Override
    public List<UUID> listHotelIds() {
        return jdbc.query("""
                        select hotel_id
                          from ota.hotel
                         order by hotel_id
                        """,
                (resultSet, rowNumber) -> resultSet.getObject("hotel_id", UUID.class));
    }

    @Override
    public Optional<Sprint1Views.ConfigurationView> findConfiguration(UUID tenantId, UUID hotelId) {
        Optional<Sprint1Views.TenantView> tenant = findTenant(tenantId);
        Optional<Sprint1Views.HotelView> hotel = one("""
                        select tenant_id, hotel_id, hotel_code, display_name, timezone,
                               lifecycle_status, collection_enabled, message_enabled, row_version
                          from ota.hotel
                         where hotel_id = ?
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.HotelView(
                        resultSet.getObject("tenant_id", UUID.class),
                        resultSet.getObject("hotel_id", UUID.class),
                        resultSet.getString("hotel_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("timezone"),
                        resultSet.getString("lifecycle_status"),
                        resultSet.getBoolean("collection_enabled"),
                        resultSet.getBoolean("message_enabled"),
                        resultSet.getLong("row_version")),
                hotelId);
        if (tenant.isEmpty() || hotel.isEmpty()) {
            return Optional.empty();
        }

        List<Sprint1Views.ConnectorView> connectors = jdbc.query("""
                        select connector.connector_id,
                               connector.adapter_code,
                               connector.source_type,
                               connector.lifecycle_status in ('READY_FOR_TEST', 'SHADOW', 'UAT') as enabled,
                               coalesce(version.non_secret_config ->> 'fixtureScenarioCode', 'BASELINE')
                                   as fixture_scenario_code,
                               coalesce((version.non_secret_config ->> 'pollIntervalMinutes')::integer, 60)
                                   as poll_interval_minutes,
                               connector.row_version,
                               exists (
                                   select 1
                                     from ota.connector_secret_binding binding
                                    where binding.hotel_id = connector.hotel_id
                                      and binding.connector_id = connector.connector_id
                                      and binding.connector_version_id =
                                          version.connector_version_id
                                      and binding.binding_status <> 'REVOKED'
                                      and connector.adapter_code <> 'FILE_FIXTURE'
                               ) as reference_configured,
                               (
                                   select binding.secret_fingerprint
                                     from ota.connector_secret_binding binding
                                    where binding.hotel_id = connector.hotel_id
                                      and binding.connector_id = connector.connector_id
                                      and binding.connector_version_id =
                                          version.connector_version_id
                                      and binding.binding_status <> 'REVOKED'
                                      and connector.adapter_code <> 'FILE_FIXTURE'
                                    order by binding.configured_at desc
                                    limit 1
                               ) as reference_fingerprint,
                               coalesce(auth.state_code, 'UNCONFIGURED') as authorization_status,
                               auth.last_probe_at
                          from ota.hotel_source_connector connector
                          left join ota.hotel_source_connector_version version
                            on version.tenant_id = connector.tenant_id
                           and version.hotel_id = connector.hotel_id
                           and version.connector_id = connector.connector_id
                           and version.status = 'ACTIVE'
                          left join ota.connector_authorization_state auth
                            on auth.tenant_id = connector.tenant_id
                           and auth.hotel_id = connector.hotel_id
                           and auth.connector_id = connector.connector_id
                         where connector.hotel_id = ?
                         order by connector.source_type, connector.connector_id
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.ConnectorView(
                        resultSet.getObject("connector_id", UUID.class),
                        resultSet.getString("adapter_code"),
                        resultSet.getString("source_type"),
                        resultSet.getBoolean("enabled"),
                        resultSet.getString("fixture_scenario_code"),
                        resultSet.getInt("poll_interval_minutes"),
                        resultSet.getLong("row_version"),
                        new Sprint1Views.SecretReferenceStatus(
                                resultSet.getBoolean("reference_configured"),
                                resultSet.getString("reference_fingerprint"),
                                resultSet.getString("authorization_status"),
                                instant(resultSet, "last_probe_at"))),
                hotelId);

        List<Sprint1Views.InventoryPoolView> pools = jdbc.query("""
                        select inventory_pool_id, pool_code, display_name,
                               coalesce(physical_capacity, 0) as physical_capacity, row_version
                          from ota.hotel_inventory_pool
                         where hotel_id = ? and status <> 'RETIRED'
                         order by pool_code
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.InventoryPoolView(
                        resultSet.getObject("inventory_pool_id", UUID.class),
                        resultSet.getString("pool_code"),
                        resultSet.getString("display_name"),
                        resultSet.getInt("physical_capacity"),
                        resultSet.getLong("row_version")),
                hotelId);

        List<Sprint1Views.SellableProductView> products = jdbc.query("""
                        select product.source_product_id,
                               product.connector_id,
                               connector.source_type,
                               coalesce(product.sell_rule_label, product.source_product_key_hash)
                                   as external_product_code,
                               product.display_name,
                               product.meal_plan_code,
                               product.row_version
                          from ota.source_sellable_product product
                          join ota.hotel_source_connector connector
                            on connector.tenant_id = product.tenant_id
                           and connector.hotel_id = product.hotel_id
                           and connector.connector_id = product.connector_id
                         where product.hotel_id = ? and product.status <> 'RETIRED'
                         order by connector.source_type, product.display_name
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.SellableProductView(
                        resultSet.getObject("source_product_id", UUID.class),
                        resultSet.getObject("connector_id", UUID.class),
                        resultSet.getString("source_type"),
                        resultSet.getString("external_product_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("meal_plan_code"),
                        resultSet.getLong("row_version")),
                hotelId);

        List<Sprint1Views.ProductMappingView> mappings = jdbc.query("""
                        select mapping.mapping_version_id,
                               mapping.source_product_id,
                               mapping.inventory_pool_id,
                               mapping.effective_from,
                               mapping.effective_until,
                               mapping.row_version
                          from ota.source_product_mapping_version mapping
                         where mapping.hotel_id = ? and mapping.status = 'ACTIVE'
                         order by mapping.source_product_id
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.ProductMappingView(
                        resultSet.getObject("mapping_version_id", UUID.class),
                        resultSet.getObject("source_product_id", UUID.class),
                        resultSet.getObject("inventory_pool_id", UUID.class),
                        instant(resultSet, "effective_from"),
                        instant(resultSet, "effective_until"),
                        resultSet.getLong("row_version")),
                hotelId);

        List<Sprint1Views.RevenueTargetView> targets = jdbc.query("""
                        select target_version_id, valid_business_date_from,
                               target_room_revenue, target_adr, row_version
                          from ota.hotel_revenue_target_version
                         where hotel_id = ? and status <> 'RETIRED'
                         order by valid_business_date_from desc, version_no desc
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.RevenueTargetView(
                        resultSet.getObject("target_version_id", UUID.class),
                        resultSet.getObject("valid_business_date_from", LocalDate.class),
                        resultSet.getBigDecimal("target_room_revenue"),
                        resultSet.getBigDecimal("target_adr"),
                        resultSet.getLong("row_version")),
                hotelId);

        List<Sprint1Views.PaceCurveView> paceCurves = jdbc.query("""
                        select pace_curve_version_id, curve_code, effective_from,
                               effective_until, row_version
                          from ota.hotel_pace_curve_version
                         where hotel_id = ? and status <> 'RETIRED'
                         order by effective_from desc, version_no desc
                        """,
                (resultSet, rowNumber) -> {
                    UUID curveId = resultSet.getObject("pace_curve_version_id", UUID.class);
                    List<Sprint1Views.PacePoint> points = jdbc.query("""
                                    select local_cutoff_time, expected_revenue_progress_pct,
                                           expected_sell_progress_pct
                                      from ota.hotel_pace_curve_point
                                     where hotel_id = ? and pace_curve_version_id = ?
                                     order by local_cutoff_time
                                    """,
                            (pointSet, pointRow) -> new Sprint1Views.PacePoint(
                                    pointSet.getObject("local_cutoff_time", LocalTime.class),
                                    pointSet.getBigDecimal("expected_revenue_progress_pct"),
                                    pointSet.getBigDecimal("expected_sell_progress_pct")),
                            hotelId, curveId);
                    return new Sprint1Views.PaceCurveView(
                            curveId,
                            resultSet.getString("curve_code"),
                            resultSet.getObject("effective_from", LocalDate.class),
                            resultSet.getObject("effective_until", LocalDate.class),
                            points,
                            resultSet.getLong("row_version"));
                },
                hotelId);

        return Optional.of(new Sprint1Views.ConfigurationView(
                tenant.orElseThrow(),
                hotel.orElseThrow(),
                connectors,
                pools,
                products,
                mappings,
                targets,
                paceCurves,
                true,
                true));
    }

    @Override
    public Optional<Sprint1Views.MonitorView> findMonitor(UUID tenantId, UUID hotelId) {
        Optional<SnapshotRow> snapshot = one("""
                        select snapshot.snapshot_id, snapshot.pms_business_date,
                               snapshot.cutoff_at, snapshot.completeness_code,
                               snapshot.reconciliation_epoch,
                               hotel.display_name
                          from ota.daily_operation_snapshot snapshot
                          join ota.hotel hotel
                            on hotel.tenant_id = snapshot.tenant_id
                           and hotel.hotel_id = snapshot.hotel_id
                         where snapshot.hotel_id = ?
                         order by snapshot.cutoff_at desc,
                                  snapshot.revision_no desc,
                                  snapshot.created_at desc,
                                  snapshot.snapshot_id desc
                         limit 1
                        """,
                JdbcSprint1ControlPlanePort::mapSnapshot,
                hotelId);
        if (snapshot.isEmpty()) {
            return Optional.empty();
        }
        SnapshotRow current = snapshot.orElseThrow();

        Map<String, Sprint1Views.MetricValue> metrics = new LinkedHashMap<>();
        jdbc.query("""
                        select metric_code, numeric_value, text_value, unit_code, quality_code
                          from ota.daily_operation_snapshot_metric
                         where hotel_id = ? and snapshot_id = ?
                         order by metric_code
                        """,
                resultSet -> {
                    BigDecimal numeric = resultSet.getBigDecimal("numeric_value");
                    metrics.put(resultSet.getString("metric_code"), new Sprint1Views.MetricValue(
                            numeric,
                            resultSet.getString("unit_code"),
                            resultSet.getString("quality_code")));
                },
                hotelId, current.snapshotId());

        List<Sprint1Views.SourceFreshnessView> sources = jdbc.query("""
                        select distinct on (connector.source_type)
                               connector.source_type,
                               run.completeness_code,
                               run.observed_at,
                               run.finished_at
                          from ota.connector_collection_run run
                          join ota.hotel_source_connector connector
                            on connector.tenant_id = run.tenant_id
                           and connector.hotel_id = run.hotel_id
                           and connector.connector_id = run.connector_id
                         where run.hotel_id = ?
                           and run.reconciliation_epoch = ?
                         order by connector.source_type, run.cutoff_at desc, run.started_at desc
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.SourceFreshnessView(
                        resultSet.getString("source_type"),
                        resultSet.getString("completeness_code"),
                        instant(resultSet, "observed_at"),
                        instant(resultSet, "finished_at")),
                hotelId, current.reconciliationEpoch());

        List<Sprint1Views.InventoryView> inventory =
                latestInventory(hotelId, current.reconciliationEpoch());
        return Optional.of(new Sprint1Views.MonitorView(
                tenantId,
                hotelId,
                current.hotelName(),
                current.businessDate(),
                current.cutoffAt(),
                current.completeness(),
                true,
                sources,
                metrics,
                inventory));
    }

    @Override
    public List<Sprint1Views.BriefView> listBriefs(UUID hotelId, int limit) {
        return jdbc.query("""
                        with brief_versions as (
                            select brief.tenant_id,
                                   brief.hotel_id,
                                   brief.hourly_brief_id as version_id,
                                   brief.hourly_brief_id,
                                   brief.pms_business_date,
                                   brief.cutoff_at,
                                   snapshot.revision_no,
                                   snapshot.completeness_code,
                                   brief.frozen_body as version_body,
                                   brief.published_at,
                                   brief.simulation_run_id,
                                   brief.created_at as version_created_at
                              from ota.ota_hourly_brief brief
                              join ota.daily_operation_snapshot snapshot
                                on snapshot.tenant_id = brief.tenant_id
                               and snapshot.hotel_id = brief.hotel_id
                               and snapshot.snapshot_id = brief.snapshot_id
                            union all
                            select adjustment.tenant_id,
                                   adjustment.hotel_id,
                                   adjustment.adjustment_id as version_id,
                                   adjustment.hourly_brief_id,
                                   brief.pms_business_date,
                                   brief.cutoff_at,
                                   replacement.revision_no,
                                   replacement.completeness_code,
                                   adjustment.replacement_frozen_body as version_body,
                                   adjustment.created_at as published_at,
                                   adjustment.simulation_run_id,
                                   adjustment.created_at as version_created_at
                              from ota.ota_brief_adjustment adjustment
                              join ota.ota_hourly_brief brief
                                on brief.tenant_id = adjustment.tenant_id
                               and brief.hotel_id = adjustment.hotel_id
                               and brief.hourly_brief_id = adjustment.hourly_brief_id
                              join ota.daily_operation_snapshot replacement
                                on replacement.tenant_id = adjustment.tenant_id
                               and replacement.hotel_id = adjustment.hotel_id
                               and replacement.snapshot_id = adjustment.replacement_snapshot_id
                        )
                        select version.version_id,
                               version.pms_business_date,
                               version.cutoff_at,
                               version.revision_no,
                               version.completeness_code,
                               version.version_body,
                               version.published_at,
                               version.simulation_run_id,
                               coalesce((
                                   select delivery.delivery_status
                                     from ota.notification_delivery delivery
                                    where delivery.hotel_id = version.hotel_id
                                      and delivery.hourly_brief_id = version.hourly_brief_id
                                    order by delivery.created_at desc
                                    limit 1
                               ), 'NOT_QUEUED') as delivery_status,
                               version.simulation_run_id is not null as simulation_mode
                          from brief_versions version
                         where version.hotel_id = ?
                         order by version.cutoff_at desc,
                                  version.revision_no desc,
                                  version.version_created_at desc
                         limit ?
                        """,
                JdbcSprint1ControlPlanePort::mapBrief,
                hotelId, limit);
    }

    @Override
    public List<Sprint1Views.IncidentView> listIncidents(UUID hotelId, int limit) {
        return jdbc.query("""
                        select incident.incident_id,
                               incident.incident_type,
                               incident.status,
                               incident.source_code,
                               incident.direction_code,
                               incident.opened_at,
                               incident.last_observed_at,
                               incident.row_version,
                               (
                                   select task.task_id
                                     from ota.ota_task task
                                    where task.hotel_id = incident.hotel_id
                                      and task.incident_id = incident.incident_id
                                    order by task.created_at desc
                                    limit 1
                               ) as task_id
                          from ota.ota_incident incident
                         where incident.hotel_id = ?
                         order by incident.opened_at desc
                         limit ?
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.IncidentView(
                        resultSet.getObject("incident_id", UUID.class),
                        resultSet.getString("incident_type"),
                        resultSet.getString("status"),
                        resultSet.getString("source_code"),
                        resultSet.getString("direction_code"),
                        instant(resultSet, "opened_at"),
                        instant(resultSet, "last_observed_at"),
                        resultSet.getObject("task_id", UUID.class),
                        resultSet.getLong("row_version")),
                hotelId, limit);
    }

    @Override
    public List<Sprint1Views.OutboxPreview> listOutboxPreview(UUID hotelId, int limit) {
        return jdbc.query("""
                        select delivery.outbox_event_id,
                               delivery.idempotency_key,
                               delivery.notification_type,
                               delivery.created_at,
                               delivery.delivery_status,
                               left(delivery.frozen_payload, 1000) as body_preview
                          from ota.notification_delivery delivery
                         where delivery.hotel_id = ?
                         order by delivery.created_at desc
                         limit ?
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.OutboxPreview(
                        resultSet.getObject("outbox_event_id", UUID.class),
                        resultSet.getString("idempotency_key"),
                        resultSet.getString("notification_type"),
                        instant(resultSet, "created_at"),
                        true,
                        resultSet.getString("delivery_status"),
                        resultSet.getString("body_preview")),
                hotelId, limit);
    }

    @Override
    public Optional<Sprint1Views.SimulationRunView> findSimulationRun(UUID hotelId, UUID runId) {
        return one(simulationRunSql() + " and simulation.simulation_run_id = ?",
                this::mapSimulationRun, hotelId, runId);
    }

    @Override
    public List<Sprint1Views.SimulationRunView> listSimulationRuns(UUID hotelId, int limit) {
        return jdbc.query(simulationRunSql() + " order by simulation.created_at desc limit ?",
                this::mapSimulationRun, hotelId, limit);
    }

    @Override
    public List<Sprint1Views.SimulationHotelView> listSimulationHotels() {
        return jdbc.query("""
                        select hotel.tenant_id,
                               hotel.hotel_id,
                               tenant.tenant_code,
                               tenant.display_name as tenant_name,
                               hotel.hotel_code,
                               hotel.display_name as hotel_name,
                               hotel.timezone,
                               hotel.lifecycle_status,
                               hotel.collection_enabled,
                               hotel.message_enabled,
                               count(connector.connector_id) filter (
                                   where connector.adapter_code in ('MOCK_PMS', 'MOCK_CTRIP', 'MOCK_MEITUAN')
                                     and connector.lifecycle_status in ('READY_FOR_TEST', 'SHADOW', 'UAT')
                               ) as mock_connector_count,
                               hotel.row_version
                          from ota.hotel hotel
                          join control.tenant_directory tenant on tenant.tenant_id = hotel.tenant_id
                          left join ota.hotel_source_connector connector
                            on connector.tenant_id = hotel.tenant_id
                           and connector.hotel_id = hotel.hotel_id
                         where not hotel.message_enabled
                         group by hotel.tenant_id, hotel.hotel_id, tenant.tenant_code,
                                  tenant.display_name, hotel.hotel_code, hotel.display_name,
                                  hotel.timezone, hotel.lifecycle_status, hotel.collection_enabled,
                                  hotel.message_enabled, hotel.row_version
                        having count(connector.connector_id) filter (
                                   where connector.adapter_code in ('MOCK_PMS', 'MOCK_CTRIP', 'MOCK_MEITUAN')
                               ) = 3
                         order by hotel.display_name
                        """,
                (resultSet, rowNumber) -> new Sprint1Views.SimulationHotelView(
                        resultSet.getObject("tenant_id", UUID.class),
                        resultSet.getObject("hotel_id", UUID.class),
                        resultSet.getString("tenant_code"),
                        resultSet.getString("tenant_name"),
                        resultSet.getString("hotel_code"),
                        resultSet.getString("hotel_name"),
                        resultSet.getString("timezone"),
                        resultSet.getString("lifecycle_status"),
                        resultSet.getBoolean("collection_enabled"),
                        resultSet.getBoolean("message_enabled"),
                        resultSet.getInt("mock_connector_count"),
                        true,
                        resultSet.getLong("row_version")));
    }

    @Override
    public boolean hasHotelScope(UUID accountId, UUID hotelId, String scopeType) {
        return hasActiveScope(accountId, hotelId, scopeType);
    }

    @Override
    public boolean hasActiveScope(UUID accountId, UUID hotelId, String scopeType) {
        Boolean allowed = jdbc.queryForObject("""
                        select exists (
                            select 1
                              from ota.account_hotel_scope scope
                             where scope.hotel_id = ?
                               and scope.account_id = ?
                               and scope.scope_type = ?
                               and scope.valid_from <= current_timestamp
                               and (scope.valid_until is null or scope.valid_until > current_timestamp)
                        )
                        """, Boolean.class, hotelId, accountId, scopeType);
        return Boolean.TRUE.equals(allowed);
    }

    @Override
    public TenantConfigurationCommandHandler.CommandReceipt handle(TenantConfigurationCommand command) {
        if (!(command instanceof Sprint1TenantCommand sprint1)) {
            throw new IllegalArgumentException("Unsupported tenant command type");
        }
        if (sprint1.mutation() instanceof Sprint1Mutations.UpsertTenant tenant) {
            return createTenant(sprint1, tenant);
        }
        if (sprint1.mutation() instanceof Sprint1Mutations.InitializeSimulationHotel initialization) {
            return initializeSimulationHotel(sprint1, initialization);
        }
        UUID hotelId = sprint1.mutation().hotelId();
        if (hotelId == null) {
            throw new IllegalArgumentException("Hotel-scoped command requires a hotel");
        }

        advisoryLock(sprint1.targetTenantId(), hotelId, sprint1.idempotencyKey());
        Optional<CommandRow> existing = commandReceipt(hotelId, sprint1.idempotencyKey());
        if (existing.isPresent()) {
            return replay(sprint1, existing.orElseThrow());
        }

        long version = switch (sprint1.mutation()) {
            case Sprint1Mutations.UpsertHotel mutation -> upsertHotel(sprint1, mutation);
            case Sprint1Mutations.UpsertConnector mutation -> upsertConnector(sprint1, mutation);
            case Sprint1Mutations.UpsertInventoryPool mutation -> upsertInventoryPool(sprint1, mutation);
            case Sprint1Mutations.UpsertSellableProduct mutation -> upsertProduct(sprint1, mutation);
            case Sprint1Mutations.UpsertProductMapping mutation -> upsertMapping(sprint1, mutation);
            case Sprint1Mutations.UpsertRevenueTarget mutation -> upsertTarget(sprint1, mutation);
            case Sprint1Mutations.UpsertPaceCurve mutation -> upsertPaceCurve(sprint1, mutation);
            case Sprint1Mutations.TriggerSimulation mutation -> triggerSimulation(sprint1, mutation);
            default -> throw new IllegalArgumentException("Unsupported Sprint 1 mutation");
        };
        UUID commandId = commandId(sprint1, hotelId);
        insertCommandReceipt(sprint1, hotelId, commandId, version, "APPLIED");
        return new TenantConfigurationCommandHandler.CommandReceipt(
                commandId.toString(), version, false);
    }

    private TenantConfigurationCommandHandler.CommandReceipt createTenant(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertTenant tenant
    ) {
        if (command.expectedRowVersion() != 0 || !"DRAFT".equals(tenant.status())) {
            throw new IllegalArgumentException("Sprint 1 tenant creation requires DRAFT and expectedRowVersion=0");
        }
        UUID commandId = stableId("TENANT_COMMAND", command.idempotencyKey());
        TenantCreationResult result = jdbc.queryForObject("""
                        select tenant_id, original_result_code
                          from control.create_tenant_directory_entry(?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                (resultSet, rowNumber) -> new TenantCreationResult(
                        resultSet.getObject("tenant_id", UUID.class),
                        resultSet.getString("original_result_code")),
                commandId,
                command.idempotencyKey(),
                command.requestHash(),
                tenant.tenantId(),
                tenant.tenantCode(),
                tenant.displayName(),
                tenant.timezone(),
                command.actorAccountId());
        if (result == null || !tenant.tenantId().equals(result.tenantId())) {
            throw new IllegalStateException("Controlled tenant creation returned an invalid result");
        }
        return new TenantConfigurationCommandHandler.CommandReceipt(
                commandId.toString(), 0, "EXISTING".equals(result.resultCode()));
    }

    private TenantConfigurationCommandHandler.CommandReceipt initializeSimulationHotel(
            Sprint1TenantCommand command,
            Sprint1Mutations.InitializeSimulationHotel initialization
    ) {
        if (command.expectedRowVersion() != 0) {
            throw new IllegalArgumentException("Simulation hotel initialization requires expectedRowVersion=0");
        }
        UUID commandId = commandId(command, initialization.hotelId());
        jdbc.queryForObject("""
                        select tenant_id
                          from control.create_tenant_directory_entry(?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                UUID.class,
                commandId,
                command.idempotencyKey(),
                command.requestHash(),
                initialization.tenantId(),
                initialization.tenantCode(),
                initialization.tenantDisplayName(),
                initialization.timezone(),
                command.actorAccountId());

        advisoryLock(initialization.tenantId(), initialization.hotelId(), command.idempotencyKey());
        Optional<CommandRow> existing = commandReceipt(
                initialization.hotelId(), command.idempotencyKey());
        if (existing.isPresent()) {
            return replay(command, existing.orElseThrow());
        }

        jdbc.update("""
                        insert into ota.hotel(
                            tenant_id, hotel_id, hotel_code, display_name, timezone,
                            lifecycle_status, collection_enabled, message_enabled
                        )
                        values (?, ?, ?, ?, ?, 'READY_FOR_TEST', true, false)
                        on conflict (tenant_id, hotel_id) do nothing
                        """,
                initialization.tenantId(),
                initialization.hotelId(),
                initialization.hotelCode(),
                initialization.hotelDisplayName(),
                initialization.timezone());
        verifySimulationHotelIdentity(initialization);
        seedBusinessDayConfiguration(command, initialization);
        seedConnector(command, initialization, initialization.pmsConnectorId(), "MOCK_PMS", "PMS");
        seedConnector(command, initialization, initialization.ctripConnectorId(), "MOCK_CTRIP", "CTRIP");
        seedConnector(command, initialization, initialization.meituanConnectorId(), "MOCK_MEITUAN", "MEITUAN");
        seedInventoryAndMappings(command, initialization);
        seedTargetAndPace(command, initialization);
        seedNotificationTarget(initialization);
        insertCommandReceipt(command, initialization.hotelId(), commandId, 0, "CREATED");
        return new TenantConfigurationCommandHandler.CommandReceipt(commandId.toString(), 0, false);
    }

    private long upsertHotel(Sprint1TenantCommand command, Sprint1Mutations.UpsertHotel hotel) {
        int updated = jdbc.update("""
                        update ota.hotel
                           set hotel_code = ?,
                               display_name = ?,
                               timezone = ?,
                               lifecycle_status = ?,
                               collection_enabled = ?,
                               message_enabled = false,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and row_version = ?
                        """,
                hotel.hotelCode(), hotel.displayName(), hotel.timezone(), hotel.lifecycleStatus(),
                hotel.collectionEnabled(), hotel.hotelId(), command.expectedRowVersion());
        if (updated == 1) {
            return command.expectedRowVersion() + 1;
        }
        if (command.expectedRowVersion() != 0 || hotelExists(hotel.hotelId())) {
            throw new RowVersionConflictException();
        }
        jdbc.update("""
                        insert into ota.hotel(
                            tenant_id, hotel_id, hotel_code, display_name, timezone,
                            lifecycle_status, collection_enabled, message_enabled
                        ) values (?, ?, ?, ?, ?, ?, ?, false)
                        """,
                command.targetTenantId(), hotel.hotelId(), hotel.hotelCode(), hotel.displayName(),
                hotel.timezone(), hotel.lifecycleStatus(), hotel.collectionEnabled());
        return 0;
    }

    private long upsertConnector(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertConnector connector
    ) {
        String lifecycle = connector.enabled() ? "READY_FOR_TEST" : "PAUSED";
        int updated = jdbc.update("""
                        update ota.hotel_source_connector
                           set source_type = ?,
                               adapter_code = ?,
                               connector_mode = ?,
                               lifecycle_status = ?,
                               display_name = ?,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and connector_id = ? and row_version = ?
                        """,
                connector.sourceCode(), connector.adapterCode(),
                "FILE_FIXTURE".equals(connector.adapterCode()) ? "FILE_IMPORT" : "SIMULATION",
                lifecycle, connector.adapterCode(), connector.hotelId(), connector.connectorId(),
                command.expectedRowVersion());
        long resultingVersion;
        if (updated == 1) {
            resultingVersion = command.expectedRowVersion() + 1;
        } else {
            if (command.expectedRowVersion() != 0
                    || connectorExists(connector.hotelId(), connector.connectorId())) {
                throw new RowVersionConflictException();
            }
            jdbc.update("""
                            insert into ota.hotel_source_connector(
                                tenant_id, hotel_id, connector_id, source_type, adapter_code,
                                connector_mode, lifecycle_status, display_name
                            ) values (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                    command.targetTenantId(), connector.hotelId(), connector.connectorId(),
                    connector.sourceCode(), connector.adapterCode(),
                    "FILE_FIXTURE".equals(connector.adapterCode()) ? "FILE_IMPORT" : "SIMULATION",
                    lifecycle, connector.adapterCode());
            resultingVersion = 0;
        }
        activateConnectorVersion(command, connector);
        upsertConnectorAuthorization(command, connector);
        disableConnectorSchedules(connector.hotelId(), connector.connectorId());
        upsertConnectorSchedules(
                command.targetTenantId(),
                connector.hotelId(),
                connector.connectorId(),
                connector.adapterCode(),
                connector.enabled());
        return resultingVersion;
    }

    private long upsertInventoryPool(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertInventoryPool pool
    ) {
        UUID standardId = stableId("STANDARD_ROOM", pool.hotelId().toString(), pool.physicalRoomTypeCode());
        jdbc.update("""
                        insert into ota.ota_standard_room_type(
                            tenant_id, hotel_id, standard_room_type_id, version_no,
                            room_type_code, display_name, status, effective_from,
                            reason_code, created_by_account_id
                        ) values (?, ?, ?, 1, ?, ?, 'ACTIVE', current_timestamp, ?, ?)
                        on conflict (tenant_id, hotel_id, standard_room_type_id, version_no)
                        do update set display_name = excluded.display_name,
                                      row_version = ota.ota_standard_room_type.row_version + 1,
                                      updated_at = current_timestamp
                        """,
                command.targetTenantId(), pool.hotelId(), standardId,
                pool.physicalRoomTypeCode(), pool.displayName(),
                command.changeReasonCode(), command.actorAccountId());
        int updated = jdbc.update("""
                        update ota.hotel_inventory_pool
                           set pool_code = ?,
                               display_name = ?,
                               standard_room_type_id = ?,
                               standard_room_type_version_no = 1,
                               physical_capacity = ?,
                               status = 'ACTIVE',
                               reason_code = ?,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and inventory_pool_id = ? and row_version = ?
                        """,
                pool.physicalRoomTypeCode(), pool.displayName(), standardId, pool.physicalRoomCount(),
                command.changeReasonCode(), pool.hotelId(), pool.inventoryPoolId(),
                command.expectedRowVersion());
        if (updated == 1) {
            return command.expectedRowVersion() + 1;
        }
        if (command.expectedRowVersion() != 0 || poolExists(pool.hotelId(), pool.inventoryPoolId())) {
            throw new RowVersionConflictException();
        }
        jdbc.update("""
                        insert into ota.hotel_inventory_pool(
                            tenant_id, hotel_id, inventory_pool_id, pool_code, display_name,
                            standard_room_type_id, standard_room_type_version_no,
                            physical_capacity, status, reason_code
                        ) values (?, ?, ?, ?, ?, ?, 1, ?, 'ACTIVE', ?)
                        """,
                command.targetTenantId(), pool.hotelId(), pool.inventoryPoolId(),
                pool.physicalRoomTypeCode(), pool.displayName(), standardId,
                pool.physicalRoomCount(), command.changeReasonCode());
        return 0;
    }

    private long upsertProduct(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertSellableProduct product
    ) {
        String productKind = "PMS".equals(product.sourceCode())
                ? "PMS_PHYSICAL_ROOM" : "OTA_SELL_PRODUCT";
        int updated = jdbc.update("""
                        update ota.source_sellable_product
                           set product_kind = ?,
                               source_product_key_hash = ?,
                               display_name = ?,
                               meal_plan_code = ?,
                               sell_rule_label = ?,
                               status = 'ACTIVE',
                               last_observed_at = current_timestamp,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and connector_id = ?
                           and source_product_id = ? and row_version = ?
                        """,
                productKind, sha256(product.externalProductCode()), product.displayName(),
                product.mealPlanCode(), product.externalProductCode(), product.hotelId(),
                product.connectorId(), product.productId(), command.expectedRowVersion());
        if (updated == 1) {
            return command.expectedRowVersion() + 1;
        }
        if (command.expectedRowVersion() != 0
                || productExists(product.hotelId(), product.productId())) {
            throw new RowVersionConflictException();
        }
        verifyConnectorSource(product.hotelId(), product.connectorId(), product.sourceCode());
        jdbc.update("""
                        insert into ota.source_sellable_product(
                            tenant_id, hotel_id, connector_id, source_product_id,
                            product_kind, source_product_key_hash, display_name,
                            meal_plan_code, sell_rule_label, status,
                            first_observed_at, last_observed_at
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE',
                                  current_timestamp, current_timestamp)
                        """,
                command.targetTenantId(), product.hotelId(), product.connectorId(), product.productId(),
                productKind, sha256(product.externalProductCode()), product.displayName(),
                product.mealPlanCode(), product.externalProductCode());
        return 0;
    }

    private long upsertMapping(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertProductMapping mapping
    ) {
        ProductIdentity product = findProductIdentity(mapping.hotelId(), mapping.productId())
                .orElseThrow(() -> new IllegalArgumentException("Mapped product does not exist"));
        jdbc.update("""
                        update ota.source_product_mapping_version
                           set status = 'RETIRED',
                               effective_until = current_timestamp,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and connector_id = ? and source_product_id = ?
                           and status = 'ACTIVE' and mapping_version_id <> ?
                        """,
                mapping.hotelId(), product.connectorId(), mapping.productId(), mapping.mappingVersionId());
        int updated = jdbc.update("""
                        update ota.source_product_mapping_version
                           set inventory_pool_id = ?,
                               status = 'ACTIVE',
                               reason_code = ?,
                               activated_at = coalesce(activated_at, current_timestamp),
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and connector_id = ? and source_product_id = ?
                           and mapping_version_id = ? and row_version = ?
                        """,
                mapping.inventoryPoolId(), command.changeReasonCode(), mapping.hotelId(),
                product.connectorId(), mapping.productId(), mapping.mappingVersionId(),
                command.expectedRowVersion());
        if (updated == 1) {
            return command.expectedRowVersion() + 1;
        }
        if (command.expectedRowVersion() != 0
                || mappingExists(mapping.hotelId(), mapping.mappingVersionId())) {
            throw new RowVersionConflictException();
        }
        Long versionNo = jdbc.queryForObject("""
                        select coalesce(max(version_no), 0) + 1
                          from ota.source_product_mapping_version
                         where hotel_id = ? and connector_id = ? and source_product_id = ?
                        """, Long.class, mapping.hotelId(), product.connectorId(), mapping.productId());
        jdbc.update("""
                        insert into ota.source_product_mapping_version(
                            tenant_id, hotel_id, connector_id, source_product_id,
                            mapping_version_id, version_no, inventory_pool_id,
                            status, effective_from, reason_code,
                            created_by_account_id, activated_at
                        ) values (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', current_timestamp, ?, ?,
                                  current_timestamp)
                        """,
                command.targetTenantId(), mapping.hotelId(), product.connectorId(), mapping.productId(),
                mapping.mappingVersionId(), versionNo, mapping.inventoryPoolId(),
                command.changeReasonCode(), command.actorAccountId());
        return 0;
    }

    private long upsertTarget(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertRevenueTarget target
    ) {
        jdbc.update("""
                        update ota.hotel_revenue_target_version
                           set status = 'RETIRED',
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ?
                           and target_version_id <> ?
                           and status = 'ACTIVE'
                           and valid_business_date_from <= ?
                           and (valid_business_date_until is null
                                or valid_business_date_until >= ?)
                        """,
                target.hotelId(), target.targetVersionId(),
                target.businessDate(), target.businessDate());
        int updated = jdbc.update("""
                        update ota.hotel_revenue_target_version
                           set valid_business_date_from = ?,
                               valid_business_date_until = ?,
                               target_room_revenue = ?,
                               target_adr = ?,
                               status = 'ACTIVE',
                               reason_code = ?,
                               activated_at = coalesce(activated_at, current_timestamp),
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and target_version_id = ? and row_version = ?
                        """,
                target.businessDate(), target.businessDate(), target.roomRevenueTarget(),
                target.targetAdr(), command.changeReasonCode(), target.hotelId(),
                target.targetVersionId(), command.expectedRowVersion());
        if (updated == 1) {
            return command.expectedRowVersion() + 1;
        }
        if (command.expectedRowVersion() != 0
                || targetExists(target.hotelId(), target.targetVersionId())) {
            throw new RowVersionConflictException();
        }
        Long versionNo = jdbc.queryForObject("""
                        select coalesce(max(version_no), 0) + 1
                          from ota.hotel_revenue_target_version
                         where hotel_id = ?
                        """, Long.class, target.hotelId());
        jdbc.update("""
                        insert into ota.hotel_revenue_target_version(
                            tenant_id, hotel_id, target_version_id, version_no,
                            valid_business_date_from, valid_business_date_until,
                            target_room_revenue, target_adr, currency_code,
                            status, reason_code, created_by_account_id, activated_at
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'CNY', 'ACTIVE', ?, ?,
                                  current_timestamp)
                        """,
                command.targetTenantId(), target.hotelId(), target.targetVersionId(), versionNo,
                target.businessDate(), target.businessDate(), target.roomRevenueTarget(),
                target.targetAdr(), command.changeReasonCode(), command.actorAccountId());
        return 0;
    }

    private long upsertPaceCurve(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertPaceCurve pace
    ) {
        jdbc.update("""
                        update ota.hotel_pace_curve_version
                           set status = 'RETIRED',
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ?
                           and pace_curve_version_id <> ?
                           and status = 'ACTIVE'
                           and effective_from <= coalesce(?, date '9999-12-31')
                           and (effective_until is null or effective_until >= ?)
                        """,
                pace.hotelId(), pace.paceCurveVersionId(),
                pace.validUntil(), pace.validFrom());
        int updated = jdbc.update("""
                        update ota.hotel_pace_curve_version
                           set curve_code = ?,
                               season_code = ?,
                               effective_from = ?,
                               effective_until = ?,
                               status = 'ACTIVE',
                               reason_code = ?,
                               activated_at = coalesce(activated_at, current_timestamp),
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ? and pace_curve_version_id = ? and row_version = ?
                        """,
                pace.curveCode(), pace.curveCode(), pace.validFrom(), pace.validUntil(),
                command.changeReasonCode(), pace.hotelId(), pace.paceCurveVersionId(),
                command.expectedRowVersion());
        long resultingVersion;
        if (updated == 1) {
            resultingVersion = command.expectedRowVersion() + 1;
        } else {
            if (command.expectedRowVersion() != 0
                    || paceExists(pace.hotelId(), pace.paceCurveVersionId())) {
                throw new RowVersionConflictException();
            }
            Long versionNo = jdbc.queryForObject("""
                            select coalesce(max(version_no), 0) + 1
                              from ota.hotel_pace_curve_version
                             where hotel_id = ?
                            """, Long.class, pace.hotelId());
            jdbc.update("""
                            insert into ota.hotel_pace_curve_version(
                                tenant_id, hotel_id, pace_curve_version_id, version_no,
                                curve_code, season_code, effective_from, effective_until,
                                tolerance_percentage_points, status, reason_code,
                                created_by_account_id, activated_at
                            ) values (?, ?, ?, ?, ?, ?, ?, ?, 2.00, 'ACTIVE', ?, ?,
                                      current_timestamp)
                            """,
                    command.targetTenantId(), pace.hotelId(), pace.paceCurveVersionId(), versionNo,
                    pace.curveCode(), pace.curveCode(), pace.validFrom(), pace.validUntil(),
                    command.changeReasonCode(), command.actorAccountId());
            resultingVersion = 0;
        }
        for (Sprint1Mutations.PacePointInput point : pace.points()) {
            jdbc.update("""
                            insert into ota.hotel_pace_curve_point(
                                tenant_id, hotel_id, pace_curve_version_id, local_cutoff_time,
                                expected_revenue_progress_pct, expected_sell_progress_pct
                            ) values (?, ?, ?, ?, ?, ?)
                            on conflict (tenant_id, hotel_id, pace_curve_version_id, local_cutoff_time)
                            do update set
                                expected_revenue_progress_pct = excluded.expected_revenue_progress_pct,
                                expected_sell_progress_pct = excluded.expected_sell_progress_pct
                            """,
                    command.targetTenantId(), pace.hotelId(), pace.paceCurveVersionId(),
                    point.cutoffLocalTime(), point.revenueProgressPercent(),
                    point.soldProgressPercent());
        }
        return resultingVersion;
    }

    private long triggerSimulation(
            Sprint1TenantCommand command,
            Sprint1Mutations.TriggerSimulation simulation
    ) {
        if (command.expectedRowVersion() != 0) {
            throw new IllegalArgumentException("New simulation runs require expectedRowVersion=0");
        }
        // Sprint 1 fixture time is frozen for deterministic replay and analysis:
        // 18:06 Asia/Shanghai execution time with an 18:00 statistics cutoff.
        Instant fixedClock = SIMULATION_EXECUTION_CLOCK;
        Instant scheduledCutoff = SIMULATION_CUTOFF;
        jdbc.update("""
                        insert into ota.simulation_run(
                            tenant_id, hotel_id, simulation_run_id, scenario_code,
                            fixed_clock_at, status, requested_by_account_id,
                            idempotency_key, request_hash, delivery_mode,
                            external_delivery_allowed
                        ) values (?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?,
                                  'SIMULATION_ONLY', false)
                        """,
                command.targetTenantId(), simulation.hotelId(), simulation.runId(),
                simulation.scenarioCode(), Timestamp.from(fixedClock), command.actorAccountId(),
                command.idempotencyKey(), command.requestHash());
        ScheduleIdentity schedule = one("""
                        select connector.connector_id, schedule.schedule_id
                          from ota.hotel_source_connector connector
                          join ota.connector_collection_schedule schedule
                            on schedule.tenant_id = connector.tenant_id
                           and schedule.hotel_id = connector.hotel_id
                           and schedule.connector_id = connector.connector_id
                         where connector.hotel_id = ?
                           and connector.adapter_code = 'MOCK_PMS'
                           and connector.lifecycle_status in ('READY_FOR_TEST', 'SHADOW', 'UAT')
                           and schedule.stream_code = 'SIMULATION_PIPELINE'
                           and schedule.trigger_type = 'MANUAL_SIMULATION'
                           and schedule.enabled
                        """,
                (resultSet, rowNumber) -> new ScheduleIdentity(
                        resultSet.getObject("connector_id", UUID.class),
                        resultSet.getObject("schedule_id", UUID.class)),
                simulation.hotelId())
                .orElseThrow(() -> new IllegalArgumentException(
                        "Enabled MOCK_PMS simulation schedule is required"));
        UUID jobId = stableId("SIMULATION_JOB", simulation.runId().toString());
        jdbc.queryForObject("""
                        select job_id
                          from control.enqueue_ota_job(?, ?, ?, ?, ?, ?, ?)
                        """,
                UUID.class,
                jobId,
                command.targetTenantId(),
                simulation.hotelId(),
                schedule.connectorId(),
                schedule.scheduleId(),
                simulation.runId(),
                Timestamp.from(scheduledCutoff));
        return 0;
    }

    private void seedBusinessDayConfiguration(
            Sprint1TenantCommand command,
            Sprint1Mutations.InitializeSimulationHotel initialization
    ) {
        jdbc.update("""
                        insert into ota.hotel_business_day_config(
                            tenant_id, hotel_id, config_id, fallback_cutoff_local_time,
                            fallback_only, status, effective_from, reason_code
                        ) values (?, ?, ?, time '06:00', true, 'ACTIVE',
                                  current_timestamp, 'SIMULATION_BOOTSTRAP')
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(),
                stableId("BUSINESS_DAY_CONFIG", initialization.hotelId().toString()));
    }

    private void seedConnector(
            Sprint1TenantCommand command,
            Sprint1Mutations.InitializeSimulationHotel initialization,
            UUID connectorId,
            String adapterCode,
            String sourceType
    ) {
        jdbc.update("""
                        insert into ota.hotel_source_connector(
                            tenant_id, hotel_id, connector_id, source_type, adapter_code,
                            connector_mode, lifecycle_status, display_name
                        ) values (?, ?, ?, ?, ?, 'SIMULATION', 'READY_FOR_TEST', ?)
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(), connectorId,
                sourceType, adapterCode, adapterCode);
        Sprint1Mutations.UpsertConnector connector = new Sprint1Mutations.UpsertConnector(
                initialization.hotelId(), connectorId, adapterCode, sourceType,
                true, "BASELINE", 60, null);
        activateConnectorVersion(command, connector);
        upsertConnectorAuthorization(command, connector);
        upsertConnectorSchedules(
                initialization.tenantId(),
                initialization.hotelId(),
                connectorId,
                adapterCode,
                true);
    }

    private void activateConnectorVersion(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertConnector connector
    ) {
        jdbc.update("""
                        update ota.hotel_source_connector_version
                           set status = 'RETIRED',
                               retired_at = current_timestamp,
                               row_version = row_version + 1
                         where hotel_id = ? and connector_id = ? and status = 'ACTIVE'
                        """, connector.hotelId(), connector.connectorId());
        Long versionNo = jdbc.queryForObject("""
                        select coalesce(max(version_no), 0) + 1
                          from ota.hotel_source_connector_version
                         where hotel_id = ? and connector_id = ?
                        """, Long.class, connector.hotelId(), connector.connectorId());
        UUID connectorVersionId = stableId(
                "CONNECTOR_VERSION", connector.connectorId().toString(), Long.toString(versionNo));
        String config = json(Map.of(
                "fixtureScenarioCode", connector.fixtureScenarioCode(),
                "pollIntervalMinutes", connector.pollIntervalMinutes()));
        jdbc.update("""
                        insert into ota.hotel_source_connector_version(
                            tenant_id, hotel_id, connector_id, connector_version_id,
                            version_no, adapter_version, parser_version,
                            non_secret_config, capability_codes, config_hash,
                            status, tested_at, activated_at, created_by_account_id
                        ) values (?, ?, ?, ?, ?, '1.0.0', '1.0.0', cast(? as jsonb),
                                  array['SIMULATION_PIPELINE']::text[], ?,
                                  'ACTIVE', current_timestamp, current_timestamp, ?)
                        """,
                command.targetTenantId(), connector.hotelId(), connector.connectorId(),
                connectorVersionId, versionNo, config, sha256(config), command.actorAccountId());
        if (connector.secretReference() != null) {
            jdbc.update("""
                            insert into ota.connector_secret_binding(
                                tenant_id, hotel_id, connector_id, connector_version_id,
                                binding_id, secret_purpose, provider_code, secret_ref,
                                secret_version, secret_fingerprint, binding_status
                            ) values (?, ?, ?, ?, ?, 'SOURCE_AUTH', ?, ?, 'UNRESOLVED', ?,
                                      'CONFIGURED')
                            """,
                    command.targetTenantId(), connector.hotelId(), connector.connectorId(),
                    connectorVersionId,
                    stableId("SECRET_BINDING", connectorVersionId.toString()),
                    connector.secretReference().substring(
                            0, connector.secretReference().indexOf("://")).toUpperCase(),
                    connector.secretReference(),
                    sha256(connector.secretReference()));
        }
    }

    private void upsertConnectorAuthorization(
            Sprint1TenantCommand command,
            Sprint1Mutations.UpsertConnector connector
    ) {
        jdbc.update("""
                        insert into ota.connector_authorization_state(
                            tenant_id, hotel_id, connector_id, authorization_state_id,
                            state_code, last_probe_at, last_probe_result_code
                        ) values (?, ?, ?, ?, 'NOT_REQUIRED', current_timestamp,
                                  'SIMULATION_NOT_REQUIRED')
                        on conflict (tenant_id, hotel_id, connector_id)
                        do update set state_code = 'NOT_REQUIRED',
                                      last_probe_at = current_timestamp,
                                      last_probe_result_code = 'SIMULATION_NOT_REQUIRED',
                                      row_version = ota.connector_authorization_state.row_version + 1,
                                      updated_at = current_timestamp
                        """,
                command.targetTenantId(), connector.hotelId(), connector.connectorId(),
                stableId("CONNECTOR_AUTH", connector.connectorId().toString()));
    }

    private void disableConnectorSchedules(
            UUID hotelId,
            UUID connectorId
    ) {
        jdbc.update("""
                        update ota.connector_collection_schedule
                           set enabled = false,
                               row_version = row_version + 1,
                               updated_at = current_timestamp
                         where hotel_id = ?
                           and connector_id = ?
                           and enabled
                        """,
                hotelId, connectorId);
    }

    private void upsertConnectorSchedules(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String adapterCode,
            boolean enabled
    ) {
        if ("MOCK_PMS".equals(adapterCode)) {
            upsertCollectionSchedule(
                    tenantId, hotelId, connectorId,
                    "SIMULATION_PIPELINE", "MANUAL_SIMULATION",
                    SIMULATION_CUTOFF, 10, enabled);
        }

        List<String> streams = switch (adapterCode) {
            case "MOCK_PMS" -> List.of(
                    "BUSINESS_DATE",
                    "ROOM_REVENUE_AGGREGATE",
                    "INVENTORY_ROOM_TYPE");
            case "MOCK_CTRIP", "MOCK_MEITUAN" -> List.of(
                    "BOOKING_EVENT",
                    "INVENTORY_SELL_PRODUCT");
            case "FILE_FIXTURE" -> List.of(
                    "BUSINESS_DATE",
                    "ROOM_REVENUE_AGGREGATE",
                    "INVENTORY_ROOM_TYPE",
                    "BOOKING_EVENT",
                    "INVENTORY_SELL_PRODUCT");
            default -> throw new IllegalArgumentException("Unsupported Sprint 1 adapter");
        };
        String triggerType = "FILE_FIXTURE".equals(adapterCode)
                ? "FILE_IMPORT"
                : "HOURLY_CUTOFF";
        Instant now = clock.instant();
        Instant nextDue = now.truncatedTo(ChronoUnit.HOURS);
        if (nextDue.isBefore(now)) {
            nextDue = nextDue.plus(1, ChronoUnit.HOURS);
        }
        int priority = "MOCK_PMS".equals(adapterCode) ? 20 : 30;
        for (String stream : streams) {
            upsertCollectionSchedule(
                    tenantId, hotelId, connectorId,
                    stream, triggerType, nextDue, priority, enabled);
        }
    }

    private void upsertCollectionSchedule(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String streamCode,
            String triggerType,
            Instant nextDueAt,
            int priority,
            boolean enabled
    ) {
        jdbc.update("""
                        insert into ota.connector_collection_schedule(
                            tenant_id, hotel_id, connector_id, schedule_id,
                            stream_code, trigger_type, interval_minutes,
                            timeout_seconds, lookback_minutes, priority_no,
                            next_due_at, enabled
                        ) values (?, ?, ?, ?, ?, ?,
                                  60, 240, 120, ?, ?, ?)
                        on conflict (tenant_id, hotel_id, connector_id, stream_code, trigger_type)
                        do update set timeout_seconds = excluded.timeout_seconds,
                                      lookback_minutes = excluded.lookback_minutes,
                                      priority_no = excluded.priority_no,
                                      next_due_at = excluded.next_due_at,
                                      enabled = excluded.enabled,
                                      row_version = ota.connector_collection_schedule.row_version + 1,
                                      updated_at = current_timestamp
                        """,
                tenantId, hotelId, connectorId,
                stableId(
                        "COLLECTION_SCHEDULE",
                        connectorId.toString(),
                        streamCode,
                        triggerType),
                streamCode,
                triggerType,
                priority,
                Timestamp.from(nextDueAt),
                enabled);
    }

    private void seedInventoryAndMappings(
            Sprint1TenantCommand command,
            Sprint1Mutations.InitializeSimulationHotel initialization
    ) {
        List<RoomSeed> rooms = List.of(
                new RoomSeed("VIEW", "景观双床房", 10),
                new RoomSeed("LUX", "轻奢大床房", 10),
                new RoomSeed("ELEGANT", "雅致双床房", 10),
                new RoomSeed("FAMILY", "亲子主题房", 4),
                new RoomSeed("STANDARD", "标准房", 16));
        Map<String, UUID> pools = new LinkedHashMap<>();
        for (RoomSeed room : rooms) {
            UUID standardId = stableId("STANDARD_ROOM", initialization.hotelId().toString(), room.code());
            UUID poolId = stableId("INVENTORY_POOL", initialization.hotelId().toString(), room.code());
            pools.put(room.code(), poolId);
            jdbc.update("""
                            insert into ota.ota_standard_room_type(
                                tenant_id, hotel_id, standard_room_type_id, version_no,
                                room_type_code, display_name, status, effective_from,
                                reason_code, created_by_account_id
                            ) values (?, ?, ?, 1, ?, ?, 'ACTIVE', current_timestamp,
                                      'SIMULATION_BOOTSTRAP', ?)
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), standardId,
                    room.code(), room.displayName(), command.actorAccountId());
            jdbc.update("""
                            insert into ota.hotel_inventory_pool(
                                tenant_id, hotel_id, inventory_pool_id, pool_code,
                                display_name, standard_room_type_id,
                                standard_room_type_version_no, physical_capacity,
                                status, reason_code
                            ) values (?, ?, ?, ?, ?, ?, 1, ?, 'ACTIVE',
                                      'SIMULATION_BOOTSTRAP')
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), poolId,
                    room.code(), room.displayName(), standardId, room.capacity());
            jdbc.update("""
                            insert into ota.inventory_policy_version(
                                tenant_id, hotel_id, inventory_pool_id, policy_version_id,
                                version_no, policy_code, status, effective_from,
                                reason_code, created_by_account_id, activated_at
                            ) values (?, ?, ?, ?, 1, 'FULL_SYNC', 'ACTIVE',
                                      current_timestamp, 'SIMULATION_BOOTSTRAP', ?,
                                      current_timestamp)
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), poolId,
                    stableId("INVENTORY_POLICY", poolId.toString()), command.actorAccountId());
        }

        List<ProductSeed> products = SIMULATION_PRODUCT_TEMPLATES.stream()
                .map(template -> new ProductSeed(
                        switch (template.connectorRole()) {
                            case "PMS" -> initialization.pmsConnectorId();
                            case "CTRIP" -> initialization.ctripConnectorId();
                            case "MEITUAN" -> initialization.meituanConnectorId();
                            default -> throw new IllegalStateException("Unknown fixture connector role");
                        },
                        template.externalCode(),
                        template.poolCode(),
                        template.productKind(),
                        template.mealPlanCode()))
                .toList();
        for (ProductSeed product : products) {
            UUID productId = stableId(
                    "SOURCE_PRODUCT", initialization.hotelId().toString(), product.externalCode());
            UUID mappingId = stableId("PRODUCT_MAPPING", productId.toString());
            jdbc.update("""
                            insert into ota.source_sellable_product(
                                tenant_id, hotel_id, connector_id, source_product_id,
                                product_kind, source_product_key_hash, display_name,
                                meal_plan_code, sell_rule_label, status,
                                first_observed_at, last_observed_at
                            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE',
                                      current_timestamp, current_timestamp)
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), product.connectorId(),
                    productId, product.productKind(), sha256(product.externalCode()),
                    product.externalCode(), product.mealPlanCode(), product.externalCode());
            jdbc.update("""
                            insert into ota.source_product_mapping_version(
                                tenant_id, hotel_id, connector_id, source_product_id,
                                mapping_version_id, version_no, inventory_pool_id,
                                status, effective_from, reason_code,
                                created_by_account_id, activated_at
                            ) values (?, ?, ?, ?, ?, 1, ?, 'ACTIVE', current_timestamp,
                                      'SIMULATION_BOOTSTRAP', ?, current_timestamp)
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), product.connectorId(),
                    productId, mappingId, pools.get(product.poolCode()), command.actorAccountId());
        }
    }

    private void seedTargetAndPace(
            Sprint1TenantCommand command,
            Sprint1Mutations.InitializeSimulationHotel initialization
    ) {
        LocalDate businessDate = SIMULATION_BUSINESS_DATE;
        UUID targetId = stableId("REVENUE_TARGET", initialization.hotelId().toString(), businessDate.toString());
        jdbc.update("""
                        insert into ota.hotel_revenue_target_version(
                            tenant_id, hotel_id, target_version_id, version_no,
                            valid_business_date_from, target_room_revenue, target_adr,
                            currency_code, status, reason_code,
                            created_by_account_id, activated_at
                        ) values (?, ?, ?, 1, ?, 10000.00, 200.00, 'CNY', 'ACTIVE',
                                  'SIMULATION_BOOTSTRAP', ?, current_timestamp)
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(), targetId,
                businessDate, command.actorAccountId());
        UUID paceId = stableId("PACE_CURVE", initialization.hotelId().toString(), "DEFAULT");
        jdbc.update("""
                        insert into ota.hotel_pace_curve_version(
                            tenant_id, hotel_id, pace_curve_version_id, version_no,
                            curve_code, season_code, effective_from,
                            tolerance_percentage_points, status, reason_code,
                            created_by_account_id, activated_at
                        ) values (?, ?, ?, 1, 'DEFAULT', 'PEAK', ?, 2.00, 'ACTIVE',
                                  'SIMULATION_BOOTSTRAP', ?, current_timestamp)
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(), paceId,
                businessDate, command.actorAccountId());
        List<Sprint1Views.PacePoint> points =
                simulationPacePoints(initialization.timezone());
        for (Sprint1Views.PacePoint point : points) {
            jdbc.update("""
                            insert into ota.hotel_pace_curve_point(
                                tenant_id, hotel_id, pace_curve_version_id, local_cutoff_time,
                                expected_revenue_progress_pct, expected_sell_progress_pct
                            ) values (?, ?, ?, ?, ?, ?)
                            on conflict do nothing
                            """,
                    initialization.tenantId(), initialization.hotelId(), paceId,
                    point.cutoffLocalTime(), point.revenueProgressPercent(),
                    point.soldProgressPercent());
        }
    }

    private void seedNotificationTarget(Sprint1Mutations.InitializeSimulationHotel initialization) {
        UUID endpointId = stableId("SIM_ENDPOINT", initialization.hotelId().toString());
        UUID targetId = stableId("SIM_NOTIFICATION_TARGET", initialization.hotelId().toString());
        jdbc.update("""
                        insert into ota.hotel_message_endpoint(
                            tenant_id, hotel_id, endpoint_id, endpoint_name,
                            endpoint_type, transport_mode, external_delivery_allowed,
                            at_all_required, test_status, status
                        ) values (?, ?, ?, 'SIMULATION_ONLY', 'HOTEL_OPERATION_GROUP',
                                  'SIMULATION_ONLY', false, true, 'SIMULATED_PASS',
                                  'SIMULATION_READY')
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(), endpointId);
        jdbc.update("""
                        insert into ota.notification_target(
                            tenant_id, hotel_id, notification_target_id, target_type,
                            endpoint_id, at_all_required, transport_mode,
                            external_delivery_allowed, status
                        ) values (?, ?, ?, 'HOTEL_OPERATION_GROUP', ?, true,
                                  'SIMULATION_ONLY', false, 'ACTIVE')
                        on conflict do nothing
                        """,
                initialization.tenantId(), initialization.hotelId(), targetId, endpointId);
    }

    private List<Sprint1Views.InventoryView> latestInventory(
            UUID hotelId,
            UUID reconciliationEpoch
    ) {
        List<InventoryItemRow> rows = jdbc.query("""
                        with latest_observation as (
                            select distinct on (observation.connector_id)
                                   observation.inventory_observation_id,
                                   observation.connector_id
                              from ota.inventory_observation observation
                             where observation.hotel_id = ?
                               and observation.reconciliation_epoch = ?
                             order by observation.connector_id, observation.observed_at desc
                        )
                        select item.inventory_pool_id,
                               pool.pool_code,
                               pool.display_name,
                               connector.source_type,
                               product.sell_rule_label as product_code,
                               item.sellable_room_count,
                               item.item_quality_code
                          from latest_observation latest
                          join ota.inventory_observation_item item
                            on item.hotel_id = ?
                           and item.inventory_observation_id = latest.inventory_observation_id
                          join ota.hotel_source_connector connector
                            on connector.tenant_id = item.tenant_id
                           and connector.hotel_id = item.hotel_id
                           and connector.connector_id = item.connector_id
                          join ota.source_sellable_product product
                            on product.tenant_id = item.tenant_id
                           and product.hotel_id = item.hotel_id
                           and product.connector_id = item.connector_id
                           and product.source_product_id = item.source_product_id
                          left join ota.hotel_inventory_pool pool
                            on pool.tenant_id = item.tenant_id
                           and pool.hotel_id = item.hotel_id
                           and pool.inventory_pool_id = item.inventory_pool_id
                         where item.inventory_pool_id is not null
                         order by pool.pool_code, connector.source_type, product.sell_rule_label
                        """,
                (resultSet, rowNumber) -> new InventoryItemRow(
                        resultSet.getObject("inventory_pool_id", UUID.class),
                        resultSet.getString("pool_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("source_type"),
                        resultSet.getString("product_code"),
                        (Integer) resultSet.getObject("sellable_room_count"),
                        resultSet.getString("item_quality_code")),
                hotelId, reconciliationEpoch, hotelId);
        Map<UUID, MutableInventory> byPool = new LinkedHashMap<>();
        for (InventoryItemRow row : rows) {
            MutableInventory inventory = byPool.computeIfAbsent(row.poolId(),
                    ignored -> new MutableInventory(
                            row.poolId(), row.poolCode(), row.displayName()));
            String key = row.sourceType() + ":" + row.productCode();
            if ("PMS".equals(row.sourceType())) {
                inventory.pmsAvailable = row.available();
            } else if (row.available() != null) {
                inventory.ota.put(key, row.available());
            }
            if (!"COMPLETE".equals(row.quality())) {
                inventory.unavailable = true;
            }
        }
        return byPool.values().stream()
                .map(value -> new Sprint1Views.InventoryView(
                        value.poolId,
                        value.poolCode,
                        value.displayName,
                        value.pmsAvailable,
                        value.ota,
                        value.unavailable ? "UNAVAILABLE"
                                : hasMismatch(value) ? "P1_RISK" : "MATCHED"))
                .toList();
    }

    private static boolean hasMismatch(MutableInventory value) {
        return inventoryCountsMismatch(value.pmsAvailable, value.ota);
    }

    static boolean inventoryCountsMismatch(Integer pmsAvailable, Map<String, Integer> otaAvailable) {
        return pmsAvailable != null
                && otaAvailable.values().stream()
                .anyMatch(ota -> !java.util.Objects.equals(ota, pmsAvailable));
    }

    static LocalTime simulationLocalCutoff(String timezone) {
        return SIMULATION_CUTOFF
                .atZone(java.time.ZoneId.of(timezone))
                .toLocalTime();
    }

    static List<Sprint1Views.PacePoint> simulationPacePoints(String timezone) {
        Map<LocalTime, Sprint1Views.PacePoint> points = new LinkedHashMap<>();
        addPacePoint(points, LocalTime.of(0, 0), "0");
        addPacePoint(points, LocalTime.of(17, 0), "80");
        addPacePoint(points, LocalTime.of(23, 0), "100");
        addPacePoint(points, simulationLocalCutoff(timezone), "88.2");
        return List.copyOf(points.values());
    }

    private static void addPacePoint(
            Map<LocalTime, Sprint1Views.PacePoint> points,
            LocalTime cutoff,
            String progress
    ) {
        BigDecimal percentage = new BigDecimal(progress);
        points.put(cutoff, new Sprint1Views.PacePoint(cutoff, percentage, percentage));
    }

    private String simulationRunSql() {
        return """
                select simulation.simulation_run_id,
                       simulation.scenario_code,
                       simulation.status,
                       simulation.fixed_clock_at,
                       simulation.started_at,
                       simulation.completed_at,
                    (
                        select adjustment.adjustment_id
                          from ota.ota_brief_adjustment adjustment
                         where adjustment.hotel_id = simulation.hotel_id
                           and adjustment.simulation_run_id = simulation.simulation_run_id
                         order by adjustment.created_at desc
                         limit 1
                    ) as adjustment_brief_id,
                    (
                        select brief.hourly_brief_id
                          from ota.ota_hourly_brief brief
                            where brief.hotel_id = simulation.hotel_id
                              and brief.simulation_run_id = simulation.simulation_run_id
                            order by brief.created_at desc
                            limit 1
                    ) as original_brief_id,
                    simulation.row_version
                  from ota.simulation_run simulation
                 where simulation.hotel_id = ?
                """;
    }

    private Sprint1Views.SimulationRunView mapSimulationRun(ResultSet resultSet, int rowNumber)
            throws SQLException {
        Instant fixedClockAt = instant(resultSet, "fixed_clock_at");
        UUID briefId = resultSet.getObject("adjustment_brief_id", UUID.class);
        if (briefId == null) {
            briefId = resultSet.getObject("original_brief_id", UUID.class);
        }
        return new Sprint1Views.SimulationRunView(
                resultSet.getObject("simulation_run_id", UUID.class),
                resultSet.getString("scenario_code"),
                resultSet.getString("status"),
                fixedClockAt,
                fixedClockAt == null ? null : fixedClockAt.truncatedTo(ChronoUnit.HOURS),
                instant(resultSet, "started_at"),
                instant(resultSet, "completed_at"),
                briefId,
                List.of(),
                resultSet.getLong("row_version"));
    }

    private void verifySimulationHotelIdentity(
            Sprint1Mutations.InitializeSimulationHotel initialization
    ) {
        Boolean valid = jdbc.queryForObject("""
                        select exists (
                            select 1
                              from ota.hotel
                             where hotel_id = ?
                               and hotel_code = ?
                               and display_name = ?
                               and timezone = ?
                               and not message_enabled
                        )
                        """, Boolean.class,
                initialization.hotelId(), initialization.hotelCode(),
                initialization.hotelDisplayName(), initialization.timezone());
        if (!Boolean.TRUE.equals(valid)) {
            throw new IdempotencyConflictException();
        }
    }

    private void verifyConnectorSource(UUID hotelId, UUID connectorId, String sourceType) {
        Boolean matches = jdbc.queryForObject("""
                        select exists (
                            select 1
                              from ota.hotel_source_connector
                             where hotel_id = ? and connector_id = ? and source_type = ?
                        )
                        """, Boolean.class, hotelId, connectorId, sourceType);
        if (!Boolean.TRUE.equals(matches)) {
            throw new IllegalArgumentException("Product source does not match its connector");
        }
    }

    private Optional<ProductIdentity> findProductIdentity(UUID hotelId, UUID productId) {
        return one("""
                        select connector_id
                          from ota.source_sellable_product
                         where hotel_id = ? and source_product_id = ?
                        """,
                (resultSet, rowNumber) -> new ProductIdentity(
                        resultSet.getObject("connector_id", UUID.class)),
                hotelId, productId);
    }

    private Optional<CommandRow> commandReceipt(UUID hotelId, String key) {
        return one("""
                        select command_id, command_type, request_hash, resource_type,
                               resource_id, resulting_row_version, result_code
                          from ota.ota_command_idempotency
                         where hotel_id = ? and idempotency_key = ?
                        """,
                (resultSet, rowNumber) -> new CommandRow(
                        resultSet.getObject("command_id", UUID.class),
                        resultSet.getString("command_type"),
                        resultSet.getString("request_hash"),
                        resultSet.getString("resource_type"),
                        resultSet.getObject("resource_id", UUID.class),
                        resultSet.getObject("resulting_row_version", Long.class),
                        resultSet.getString("result_code")),
                hotelId, key);
    }

    private TenantConfigurationCommandHandler.CommandReceipt replay(
            Sprint1TenantCommand command,
            CommandRow existing
    ) {
        if (!existing.requestHash().equalsIgnoreCase(command.requestHash())
                || !existing.commandType().equals(command.mutation().kind())
                || !existing.resourceType().equals(command.mutation().resourceType())
                || !existing.resourceId().equals(command.mutation().resourceId())) {
            throw new IdempotencyConflictException();
        }
        return new TenantConfigurationCommandHandler.CommandReceipt(
                existing.commandId().toString(),
                existing.resultingRowVersion() == null ? 0 : existing.resultingRowVersion(),
                true);
    }

    private void insertCommandReceipt(
            Sprint1TenantCommand command,
            UUID hotelId,
            UUID commandId,
            long resultingVersion,
            String resultCode
    ) {
        jdbc.update("""
                        insert into ota.ota_command_idempotency(
                            tenant_id, hotel_id, command_id, idempotency_key,
                            command_type, request_hash, resource_type, resource_id,
                            resulting_row_version, result_code
                        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                command.targetTenantId(), hotelId, commandId, command.idempotencyKey(),
                command.mutation().kind(), command.requestHash(),
                command.mutation().resourceType(), command.mutation().resourceId(),
                resultingVersion, resultCode);
    }

    private void advisoryLock(UUID tenantId, UUID hotelId, String key) {
        jdbc.queryForObject("""
                        select pg_advisory_xact_lock(
                            hashtextextended(cast(? as text), 0)
                        )
                        """, Object.class, tenantId + "|" + hotelId + "|" + key);
    }

    private UUID commandId(Sprint1TenantCommand command, UUID hotelId) {
        return stableId("COMMAND", command.targetTenantId().toString(),
                hotelId.toString(), command.idempotencyKey());
    }

    private boolean hotelExists(UUID hotelId) {
        return exists("select exists(select 1 from ota.hotel where hotel_id = ?)", hotelId);
    }

    private boolean connectorExists(UUID hotelId, UUID connectorId) {
        return exists("""
                select exists(select 1 from ota.hotel_source_connector
                               where hotel_id = ? and connector_id = ?)
                """, hotelId, connectorId);
    }

    private boolean poolExists(UUID hotelId, UUID poolId) {
        return exists("""
                select exists(select 1 from ota.hotel_inventory_pool
                               where hotel_id = ? and inventory_pool_id = ?)
                """, hotelId, poolId);
    }

    private boolean productExists(UUID hotelId, UUID productId) {
        return exists("""
                select exists(select 1 from ota.source_sellable_product
                               where hotel_id = ? and source_product_id = ?)
                """, hotelId, productId);
    }

    private boolean mappingExists(UUID hotelId, UUID mappingId) {
        return exists("""
                select exists(select 1 from ota.source_product_mapping_version
                               where hotel_id = ? and mapping_version_id = ?)
                """, hotelId, mappingId);
    }

    private boolean targetExists(UUID hotelId, UUID targetId) {
        return exists("""
                select exists(select 1 from ota.hotel_revenue_target_version
                               where hotel_id = ? and target_version_id = ?)
                """, hotelId, targetId);
    }

    private boolean paceExists(UUID hotelId, UUID paceId) {
        return exists("""
                select exists(select 1 from ota.hotel_pace_curve_version
                               where hotel_id = ? and pace_curve_version_id = ?)
                """, hotelId, paceId);
    }

    private boolean exists(String sql, Object... arguments) {
        return Boolean.TRUE.equals(jdbc.queryForObject(sql, Boolean.class, arguments));
    }

    private <T> Optional<T> one(
            String sql,
            org.springframework.jdbc.core.RowMapper<T> mapper,
            Object... arguments
    ) {
        return jdbc.query(sql, mapper, arguments).stream().findFirst();
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("Controlled configuration could not be serialized", exception);
        }
    }

    private static Instant instant(ResultSet resultSet, String column) throws SQLException {
        Timestamp value = resultSet.getTimestamp(column);
        return value == null ? null : value.toInstant();
    }

    static SnapshotRow mapSnapshot(ResultSet resultSet, int rowNumber) throws SQLException {
        return new SnapshotRow(
                resultSet.getObject("snapshot_id", UUID.class),
                resultSet.getObject("pms_business_date", LocalDate.class),
                instant(resultSet, "cutoff_at"),
                resultSet.getString("completeness_code"),
                resultSet.getObject("reconciliation_epoch", UUID.class),
                resultSet.getString("display_name"));
    }

    static Sprint1Views.BriefView mapBrief(ResultSet resultSet, int rowNumber)
            throws SQLException {
        return new Sprint1Views.BriefView(
                resultSet.getObject("version_id", UUID.class),
                resultSet.getObject("pms_business_date", LocalDate.class),
                instant(resultSet, "cutoff_at"),
                resultSet.getInt("revision_no"),
                resultSet.getString("completeness_code"),
                resultSet.getString("version_body"),
                instant(resultSet, "published_at"),
                resultSet.getObject("simulation_run_id", UUID.class),
                resultSet.getString("delivery_status"),
                resultSet.getBoolean("simulation_mode"));
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private static UUID stableId(String... parts) {
        return UUID.nameUUIDFromBytes(String.join("|", parts).getBytes(StandardCharsets.UTF_8));
    }

    static List<String> simulationProductCodes() {
        return SIMULATION_PRODUCT_TEMPLATES.stream()
                .map(ProductTemplate::externalCode)
                .toList();
    }

    static Map<String, String> simulationProductHashes() {
        return SIMULATION_PRODUCT_TEMPLATES.stream().collect(
                java.util.stream.Collectors.toUnmodifiableMap(
                        ProductTemplate::externalCode,
                        template -> sha256(template.externalCode())));
    }

    record SnapshotRow(
            UUID snapshotId,
            LocalDate businessDate,
            Instant cutoffAt,
            String completeness,
            UUID reconciliationEpoch,
            String hotelName
    ) {
    }

    private record TenantCreationResult(UUID tenantId, String resultCode) {
    }

    private record CommandRow(
            UUID commandId,
            String commandType,
            String requestHash,
            String resourceType,
            UUID resourceId,
            Long resultingRowVersion,
            String resultCode
    ) {
    }

    private record ProductIdentity(UUID connectorId) {
    }

    private record ScheduleIdentity(UUID connectorId, UUID scheduleId) {
    }

    private record RoomSeed(String code, String displayName, int capacity) {
    }

    private record ProductSeed(
            UUID connectorId,
            String externalCode,
            String poolCode,
            String productKind,
            String mealPlanCode
    ) {
    }

    private record ProductTemplate(
            String connectorRole,
            String externalCode,
            String poolCode,
            String productKind,
            String mealPlanCode
    ) {
    }

    private record InventoryItemRow(
            UUID poolId,
            String poolCode,
            String displayName,
            String sourceType,
            String productCode,
            Integer available,
            String quality
    ) {
    }

    private static final class MutableInventory {
        private final UUID poolId;
        private final String poolCode;
        private final String displayName;
        private Integer pmsAvailable;
        private final Map<String, Integer> ota = new LinkedHashMap<>();
        private boolean unavailable;

        private MutableInventory(UUID poolId, String poolCode, String displayName) {
            this.poolId = poolId;
            this.poolCode = poolCode;
            this.displayName = displayName;
        }
    }
}
