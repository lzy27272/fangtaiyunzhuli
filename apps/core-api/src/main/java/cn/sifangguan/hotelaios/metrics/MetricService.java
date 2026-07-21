package cn.sifangguan.hotelaios.metrics;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class MetricService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;

    public MetricService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> definitions() {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select id, code, name, unit, value_type, aggregation, description, status
                from metric_definition where tenant_id = :tenantId order by code
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> createDefinition(MetricModels.CreateMetric request) {
        accessPolicy.requirePermission("metric.record");
        TenantPrincipal principal = prepare();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into metric_definition
                    (id, tenant_id, code, name, unit, value_type, aggregation, description)
                values
                    (:id, :tenantId, :code, :name, :unit, :valueType, :aggregation, :description)
                """, base(principal)
                .addValue("id", id)
                .addValue("code", request.code().trim().toUpperCase())
                .addValue("name", request.name().trim())
                .addValue("unit", request.unit().trim())
                .addValue("valueType", request.valueType() == null ? "DECIMAL" : request.valueType().toUpperCase())
                .addValue("aggregation", request.aggregation() == null ? "LAST" : request.aggregation().toUpperCase())
                .addValue("description", request.description()));
        auditWriter.record("METRIC_DEFINED", "METRIC_DEFINITION", id, "{\"code\":\"" + request.code() + "\"}");
        return Map.of("id", id, "code", request.code(), "name", request.name());
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> observations(UUID hotelId, String from, String to) {
        accessPolicy.requirePermission("org.read");
        TenantPrincipal principal = prepare();
        accessPolicy.requireOrgScope(hotelId);
        return jdbc.queryForList("""
                select o.id, o.business_date, o.value, o.source_type, o.source_record_id,
                       o.quality_status, m.code as metric_code, m.name as metric_name, m.unit
                from metric_observation o
                join metric_definition m on m.tenant_id = o.tenant_id and m.id = o.metric_id
                where o.tenant_id = :tenantId and o.hotel_org_unit_id = :hotelId
                  and (cast(:fromDate as date) is null or o.business_date >= cast(:fromDate as date))
                  and (cast(:toDate as date) is null or o.business_date <= cast(:toDate as date))
                order by o.business_date desc, m.code
                """, base(principal)
                .addValue("hotelId", hotelId)
                .addValue("fromDate", normalize(from))
                .addValue("toDate", normalize(to)));
    }

    @Transactional
    public Map<String, Object> record(MetricModels.RecordObservation request) {
        accessPolicy.requirePermission("metric.record");
        TenantPrincipal principal = prepare();
        accessPolicy.requireOrgScope(request.hotelOrgUnitId());
        requireHotel(principal, request.hotelOrgUnitId());
        requireMetric(principal, request.metricId());
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into metric_observation
                    (id, tenant_id, hotel_org_unit_id, metric_id, business_date, value,
                     source_type, source_record_id, entered_by)
                values
                    (:id, :tenantId, :hotelId, :metricId, :businessDate, :value,
                     :sourceType, :sourceRecordId, :actorId)
                """, base(principal)
                .addValue("id", id)
                .addValue("hotelId", request.hotelOrgUnitId())
                .addValue("metricId", request.metricId())
                .addValue("businessDate", request.businessDate())
                .addValue("value", request.value())
                .addValue("sourceType", request.sourceType().toUpperCase())
                .addValue("sourceRecordId", request.sourceRecordId())
                .addValue("actorId", principal.actorId()));
        auditWriter.record("METRIC_RECORDED", "METRIC_OBSERVATION", id,
                "{\"hotelId\":\"" + request.hotelOrgUnitId() + "\",\"metricId\":\"" + request.metricId() + "\"}");
        auditWriter.emit("METRIC_OBSERVATION", id, "MetricObservationRecorded",
                "{\"observationId\":\"" + id + "\",\"hotelId\":\"" + request.hotelOrgUnitId() + "\"}");
        return Map.of("id", id, "businessDate", request.businessDate(), "value", request.value());
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private void requireHotel(TenantPrincipal principal, UUID hotelId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from org_unit
                where tenant_id = :tenantId and id = :hotelId and unit_type = 'HOTEL'
                """, base(principal).addValue("hotelId", hotelId), Integer.class);
        if (count == null || count != 1) {
            throw new IllegalArgumentException("目标不是当前租户的有效门店");
        }
    }

    private void requireMetric(TenantPrincipal principal, UUID metricId) {
        Integer count = jdbc.queryForObject("""
                select count(*) from metric_definition
                where tenant_id = :tenantId and id = :metricId and status = 'ACTIVE'
                """, base(principal).addValue("metricId", metricId), Integer.class);
        if (count == null || count != 1) {
            throw new IllegalArgumentException("经营指标不存在或已停用");
        }
    }

    private String normalize(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
