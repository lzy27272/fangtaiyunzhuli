package cn.sifangguan.hotelaios.shared.audit;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.events.OutboxCreatedEvent;
import cn.sifangguan.hotelaios.shared.events.EventTypeNames;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
public class AuditWriter {
    private final NamedParameterJdbcTemplate jdbc;
    private final ApplicationEventPublisher events;

    public AuditWriter(NamedParameterJdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    public void record(String action, String resourceType, UUID resourceId, String afterJson) {
        TenantPrincipal principal = TenantContext.require();
        jdbc.update("""
                insert into audit_log
                    (tenant_id, actor_id, action, resource_type, resource_id,
                     correlation_id, trace_id, outcome, sensitivity_level, after_data)
                values
                    (:tenantId, :actorId, :action, :resourceType, :resourceId,
                     :correlationId, :traceId, 'SUCCESS', 'INTERNAL', cast(:afterJson as jsonb))
                """, new MapSqlParameterSource()
                .addValue("tenantId", principal.tenantId())
                .addValue("actorId", principal.actorId())
                .addValue("action", action)
                .addValue("resourceType", resourceType)
                .addValue("resourceId", resourceId)
                .addValue("correlationId", principal.correlationId())
                .addValue("traceId", principal.correlationId())
                .addValue("afterJson", afterJson == null ? "{}" : afterJson));
    }

    public UUID emit(String aggregateType, UUID aggregateId, String eventType, String payloadJson) {
        TenantPrincipal principal = TenantContext.require();
        UUID eventId = UUID.randomUUID();
        jdbc.update("""
                insert into outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, payload,
                     producer, trace_id, correlation_id, idempotency_key,
                     actor_account_id, sensitivity_level)
                values
                    (:id, :tenantId, :aggregateType, :aggregateId, :eventType, cast(:payload as jsonb),
                     'core-api', :traceId, :correlationId, :idempotencyKey,
                     :actorId, 'INTERNAL')
                """, new MapSqlParameterSource()
                .addValue("id", eventId)
                .addValue("tenantId", principal.tenantId())
                .addValue("aggregateType", aggregateType)
                .addValue("aggregateId", aggregateId)
                .addValue("eventType", EventTypeNames.normalize(eventType))
                .addValue("traceId", principal.correlationId())
                .addValue("correlationId", principal.correlationId())
                .addValue("idempotencyKey", "event:" + eventId)
                .addValue("actorId", principal.actorId())
                .addValue("payload", payloadJson));
        events.publishEvent(new OutboxCreatedEvent(principal.tenantId(), eventId, principal.correlationId()));
        return eventId;
    }
}
