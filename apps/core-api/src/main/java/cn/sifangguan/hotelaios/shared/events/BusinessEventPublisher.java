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
}
