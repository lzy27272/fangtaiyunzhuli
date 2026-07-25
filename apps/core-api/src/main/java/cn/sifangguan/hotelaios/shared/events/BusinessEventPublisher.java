package cn.sifangguan.hotelaios.shared.events;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;
import java.util.Locale;

/**
 * Backwards-compatible typed publisher over the existing transactional outbox.
 * Existing {@code AuditWriter.emit(...)} callers remain unchanged.
 */
@Component
public class BusinessEventPublisher {
    private final NamedParameterJdbcTemplate jdbc;
    private final ObjectMapper objectMapper;
    private final ApplicationEventPublisher applicationEvents;

    public BusinessEventPublisher(
            NamedParameterJdbcTemplate jdbc,
            ObjectMapper objectMapper,
            ApplicationEventPublisher applicationEvents
    ) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
        this.applicationEvents = applicationEvents;
    }

    @Transactional(propagation = Propagation.MANDATORY)
    public PublishedEvent publish(BusinessEvent event) {
        TenantPrincipal principal = TenantContext.require();
        UUID eventId = UUID.randomUUID();
        UUID traceId = event.traceId() == null ? principal.correlationId() : event.traceId();
        ObjectNode envelope = envelope(eventId, principal, event, traceId);
        jdbc.update("""
                insert into outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version, payload,
                     producer, trace_id, correlation_id, causation_id, idempotency_key,
                     org_unit_id, hotel_org_unit_id, business_date, actor_account_id,
                     actor_assignment_id, sensitivity_level)
                values
                    (:id, :tenantId, :aggregateType, :aggregateId, :eventType, :schemaVersion,
                     cast(:payload as jsonb), :producer, :traceId, :correlationId, :causationId,
                     :idempotencyKey, :orgUnitId, :hotelOrgUnitId, :businessDate, :actorId,
                     :actorAssignmentId, :sensitivity)
                """, new MapSqlParameterSource()
                .addValue("id", eventId)
                .addValue("tenantId", principal.tenantId())
                .addValue("aggregateType", event.aggregateType().toUpperCase(Locale.ROOT))
                .addValue("aggregateId", event.aggregateId())
                .addValue("eventType", event.eventType())
                .addValue("schemaVersion", event.schemaVersion())
                .addValue("producer", event.producer())
                .addValue("traceId", traceId)
                .addValue("correlationId", principal.correlationId())
                .addValue("causationId", event.causationId())
                .addValue("idempotencyKey", event.idempotencyKey())
                .addValue("orgUnitId", event.orgUnitId())
                .addValue("hotelOrgUnitId", event.hotelOrgUnitId())
                .addValue("businessDate", event.businessDate())
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", event.actorAssignmentId())
                .addValue("sensitivity", event.sensitivity())
                .addValue("payload", envelope.toString()));
        applicationEvents.publishEvent(new OutboxCreatedEvent(
                principal.tenantId(), eventId, principal.correlationId()));
        return new PublishedEvent(eventId, principal.correlationId(), event.eventType(), event.schemaVersion());
    }

    /**
     * Publishes a deterministic event once for the supplied tenant/idempotency key.
     *
     * <p>This is intended for polling schedulers. The outbox unique index is the
     * concurrency boundary, so overlapping workers cannot produce duplicate rule
     * evaluations or notifications.</p>
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public IdempotentPublishedEvent publishIfAbsent(BusinessEvent event) {
        if (event.idempotencyKey() == null || event.idempotencyKey().isBlank()) {
            throw new IllegalArgumentException("idempotencyKey is required for publishIfAbsent");
        }
        TenantPrincipal principal = TenantContext.require();
        UUID eventId = UUID.randomUUID();
        UUID traceId = event.traceId() == null ? principal.correlationId() : event.traceId();
        ObjectNode envelope = envelope(eventId, principal, event, traceId);
        List<UUID> inserted = jdbc.query("""
                insert into outbox_event
                    (id, tenant_id, aggregate_type, aggregate_id, event_type, schema_version, payload,
                     producer, trace_id, correlation_id, causation_id, idempotency_key,
                     org_unit_id, hotel_org_unit_id, business_date, actor_account_id,
                     actor_assignment_id, sensitivity_level)
                values
                    (:id, :tenantId, :aggregateType, :aggregateId, :eventType, :schemaVersion,
                     cast(:payload as jsonb), :producer, :traceId, :correlationId, :causationId,
                     :idempotencyKey, :orgUnitId, :hotelOrgUnitId, :businessDate, :actorId,
                     :actorAssignmentId, :sensitivity)
                on conflict (tenant_id, idempotency_key) do nothing
                returning id
                """, eventParameters(eventId, principal, event, traceId, envelope),
                (rs, rowNum) -> rs.getObject("id", UUID.class));
        if (!inserted.isEmpty()) {
            applicationEvents.publishEvent(new OutboxCreatedEvent(
                    principal.tenantId(), eventId, principal.correlationId()));
            return new IdempotentPublishedEvent(
                    eventId, principal.correlationId(), event.eventType(), event.schemaVersion(), true);
        }
        MapSqlParameterSource key = new MapSqlParameterSource()
                .addValue("tenantId", principal.tenantId())
                .addValue("idempotencyKey", event.idempotencyKey());
        return jdbc.queryForObject("""
                select id, correlation_id, event_type, schema_version
                from outbox_event
                where tenant_id = :tenantId and idempotency_key = :idempotencyKey
                """, key, (rs, rowNum) -> new IdempotentPublishedEvent(
                rs.getObject("id", UUID.class),
                rs.getObject("correlation_id", UUID.class),
                rs.getString("event_type"),
                rs.getInt("schema_version"),
                false));
    }

    private MapSqlParameterSource eventParameters(
            UUID eventId,
            TenantPrincipal principal,
            BusinessEvent event,
            UUID traceId,
            ObjectNode envelope
    ) {
        return new MapSqlParameterSource()
                .addValue("id", eventId)
                .addValue("tenantId", principal.tenantId())
                .addValue("aggregateType", event.aggregateType().toUpperCase(Locale.ROOT))
                .addValue("aggregateId", event.aggregateId())
                .addValue("eventType", event.eventType())
                .addValue("schemaVersion", event.schemaVersion())
                .addValue("producer", event.producer())
                .addValue("traceId", traceId)
                .addValue("correlationId", principal.correlationId())
                .addValue("causationId", event.causationId())
                .addValue("idempotencyKey", event.idempotencyKey())
                .addValue("orgUnitId", event.orgUnitId())
                .addValue("hotelOrgUnitId", event.hotelOrgUnitId())
                .addValue("businessDate", event.businessDate())
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", event.actorAssignmentId())
                .addValue("sensitivity", event.sensitivity())
                .addValue("payload", envelope.toString());
    }

    private ObjectNode envelope(UUID eventId, TenantPrincipal principal, BusinessEvent event, UUID traceId) {
        ObjectNode envelope = objectMapper.createObjectNode();
        envelope.put("eventId", eventId.toString());
        envelope.put("eventType", event.eventType());
        envelope.put("schemaVersion", event.schemaVersion());
        envelope.put("producer", event.producer());
        envelope.put("tenantId", principal.tenantId().toString());
        putUuid(envelope, "orgUnitId", event.orgUnitId());
        putUuid(envelope, "hotelOrgUnitId", event.hotelOrgUnitId());
        putUuid(envelope, "positionAssignmentId", event.positionAssignmentId());
        if (event.businessDate() != null) envelope.put("businessDate", event.businessDate().toString());
        putUuid(envelope, "traceId", traceId);
        envelope.put("correlationId", principal.correlationId().toString());
        putUuid(envelope, "causationId", event.causationId());
        if (event.idempotencyKey() != null && !event.idempotencyKey().isBlank()) {
            envelope.put("idempotencyKey", event.idempotencyKey());
        }
        envelope.put("sensitivity", event.sensitivity());
        ObjectNode aggregate = envelope.putObject("aggregate");
        aggregate.put("type", event.aggregateType().toUpperCase(Locale.ROOT));
        aggregate.put("id", event.aggregateId().toString());
        ObjectNode actor = envelope.putObject("actor");
        actor.put("accountId", principal.actorId().toString());
        putUuid(actor, "assignmentId", event.actorAssignmentId());
        envelope.set("payload", event.payload().deepCopy());
        return envelope;
    }

    private static void putUuid(ObjectNode node, String field, UUID value) {
        if (value != null) node.put(field, value.toString());
    }

    public record PublishedEvent(UUID eventId, UUID correlationId, String eventType, int schemaVersion) {
    }

    public record IdempotentPublishedEvent(
            UUID eventId,
            UUID correlationId,
            String eventType,
            int schemaVersion,
            boolean created
    ) {
    }
}
