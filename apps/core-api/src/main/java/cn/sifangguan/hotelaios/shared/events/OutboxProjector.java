package cn.sifangguan.hotelaios.shared.events;

import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Reliable, idempotent projection from the transactional outbox to management events. */
@Component
public class OutboxProjector {
    public static final String CONSUMER_CODE = "MANAGEMENT_EVENT_PROJECTOR_V1";
    private static final int MAX_ATTEMPTS = 5;

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final ObjectMapper objectMapper;
    private final TransactionTemplate requiresNew;

    public OutboxProjector(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            ObjectMapper objectMapper,
            PlatformTransactionManager transactionManager
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.objectMapper = objectMapper;
        this.requiresNew = new TransactionTemplate(transactionManager);
        this.requiresNew.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public ProjectionResult projectOne(UUID tenantId, UUID outboxEventId, String workerId) {
        try {
            ProjectionResult result = requiresNew.execute(status -> doProject(tenantId, outboxEventId, workerId));
            return result == null
                    ? new ProjectionResult(outboxEventId, null, "FAILED", "投影事务未返回结果")
                    : result;
        } catch (RuntimeException exception) {
            String message = safeMessage(exception);
            markFailure(tenantId, outboxEventId, message);
            return new ProjectionResult(outboxEventId, null, "FAILED", message);
        }
    }

    public List<ProjectionResult> projectPending(UUID tenantId, int requestedLimit, String workerId) {
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        List<UUID> ids = requiresNew.execute(status -> {
            databaseContext.apply(tenantId);
            return jdbc.queryForList("""
                    select id from outbox_event
                    where tenant_id = :tenantId and available_at <= now()
                      and (
                        status in ('PENDING', 'FAILED')
                        or (status = 'PROCESSING' and locked_until < now())
                      )
                    order by occurred_at, id
                    limit :limit
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("limit", limit), UUID.class);
        });
        List<ProjectionResult> results = new ArrayList<>();
        if (ids != null) {
            for (UUID id : ids) {
                results.add(projectOne(tenantId, id, workerId));
            }
        }
        return List.copyOf(results);
    }

    /** Returns rule-consumption work that was projected but not completed, including failed actions. */
    public List<UUID> findRecoverableManagementEvents(UUID tenantId, int requestedLimit) {
        int limit = Math.max(1, Math.min(requestedLimit, 100));
        List<UUID> ids = requiresNew.execute(status -> {
            databaseContext.apply(tenantId);
            jdbc.update("""
                    update management_event
                    set processing_status = case when attempt_count >= :maxAttempts
                                                  then 'DEAD_LETTER' else 'FAILED' end,
                        locked_by = null,
                        locked_until = case when attempt_count >= :maxAttempts
                                             then null else now() end,
                        last_error = coalesce(last_error, 'worker lease expired; queued for recovery'),
                        row_version = row_version + 1
                    where tenant_id = :tenantId and processing_status = 'PROCESSING'
                      and locked_until < now()
                    """, new MapSqlParameterSource("tenantId", tenantId)
                    .addValue("maxAttempts", MAX_ATTEMPTS));
            return jdbc.queryForList("""
                    select id from management_event
                    where tenant_id = :tenantId and processing_status in ('PENDING', 'FAILED')
                      and attempt_count < :maxAttempts
                      and (locked_until is null or locked_until <= now())
                    order by occurred_at, id
                    limit :limit
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("maxAttempts", MAX_ATTEMPTS)
                    .addValue("limit", limit), UUID.class);
        });
        return ids == null ? List.of() : List.copyOf(ids);
    }

    public void scheduleManagementEventRetry(UUID tenantId, UUID managementEventId, String error) {
        requiresNew.executeWithoutResult(status -> {
            databaseContext.apply(tenantId);
            jdbc.update("""
                    update management_event
                    set processing_status = case when attempt_count >= :maxAttempts
                                                  then 'DEAD_LETTER' else 'FAILED' end,
                        locked_by = null,
                        locked_until = case
                            when attempt_count >= :maxAttempts then null
                            else now() + make_interval(secs => case attempt_count
                                when 0 then 5
                                when 1 then 5
                                when 2 then 30
                                when 3 then 120
                                else 600 end)
                        end,
                        last_error = :error,
                        row_version = row_version + 1
                    where tenant_id = :tenantId and id = :eventId
                      and processing_status not in ('PROCESSED', 'DEAD_LETTER')
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("eventId", managementEventId)
                    .addValue("maxAttempts", MAX_ATTEMPTS)
                    .addValue("error", error));
        });
    }

    public int countDeadLetters(UUID tenantId) {
        Integer count = requiresNew.execute(status -> {
            databaseContext.apply(tenantId);
            return jdbc.queryForObject("""
                    select count(*) from outbox_event
                    where tenant_id = :tenantId and status = 'DEAD_LETTER'
                    """, new MapSqlParameterSource("tenantId", tenantId), Integer.class);
        });
        return count == null ? 0 : count;
    }

    public int countManagementEventDeadLetters(UUID tenantId) {
        Integer count = requiresNew.execute(status -> {
            databaseContext.apply(tenantId);
            return jdbc.queryForObject("""
                    select count(*) from management_event
                    where tenant_id = :tenantId and processing_status = 'DEAD_LETTER'
                    """, new MapSqlParameterSource("tenantId", tenantId), Integer.class);
        });
        return count == null ? 0 : count;
    }

    private ProjectionResult doProject(UUID tenantId, UUID outboxEventId, String workerId) {
        databaseContext.apply(tenantId);
        MapSqlParameterSource key = new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("eventId", outboxEventId)
                .addValue("workerId", workerId);

        int claimed = jdbc.update("""
                update outbox_event
                set status = 'PROCESSING', locked_by = :workerId,
                    locked_until = now() + interval '30 seconds',
                    attempt_count = attempt_count + 1, row_version = row_version + 1,
                    last_error = null
                where tenant_id = :tenantId and id = :eventId and available_at <= now()
                  and (
                    status in ('PENDING', 'FAILED')
                    or (status = 'PROCESSING' and locked_until < now())
                  )
                """, key);
        if (claimed == 0) {
            List<UUID> existing = jdbc.queryForList("""
                    select id from management_event
                    where tenant_id = :tenantId and source_event_id = :eventId
                    order by created_at limit 1
                    """, key, UUID.class);
            return new ProjectionResult(
                    outboxEventId,
                    existing.isEmpty() ? null : existing.getFirst(),
                    existing.isEmpty() ? "SKIPPED" : "PUBLISHED",
                    null
            );
        }

        Map<String, Object> source = jdbc.queryForMap("""
                select aggregate_type, aggregate_id, event_type, schema_version,
                       payload, occurred_at
                from outbox_event
                where tenant_id = :tenantId and id = :eventId
                for update
                """, key);
        JsonNode payload = parse(source.get("payload"));
        UUID orgUnitId = optionalUuid(payload, "orgUnitId", "org_unit_id", "targetOrgUnitId");
        UUID assignmentId = optionalUuid(payload, "positionAssignmentId", "position_assignment_id");

        jdbc.update("""
                insert into event_consumer_inbox
                    (tenant_id, consumer_code, outbox_event_id, status, attempt_count,
                     locked_by, locked_until)
                values
                    (:tenantId, :consumerCode, :eventId, 'PROCESSING', 1,
                     :workerId, now() + interval '30 seconds')
                on conflict (tenant_id, consumer_code, outbox_event_id) do nothing
                """, key.addValue("consumerCode", CONSUMER_CODE));

        UUID managementEventId = UUID.randomUUID();
        int inserted = jdbc.update("""
                insert into management_event
                    (id, tenant_id, source_event_id, event_type, schema_version,
                     org_unit_id, position_assignment_id, occurred_at, payload_snapshot)
                values
                    (:managementEventId, :tenantId, :eventId, :eventType, :schemaVersion,
                     :orgUnitId, :assignmentId, :occurredAt, cast(:payload as jsonb))
                on conflict (tenant_id, source_event_id, event_type) do nothing
                """, key
                .addValue("managementEventId", managementEventId)
                .addValue("eventType", EventTypeNames.normalize(String.valueOf(source.get("event_type"))))
                .addValue("schemaVersion", source.get("schema_version"))
                .addValue("orgUnitId", orgUnitId)
                .addValue("assignmentId", assignmentId)
                .addValue("occurredAt", source.get("occurred_at"))
                .addValue("payload", payload.toString()));
        if (inserted == 0) {
            managementEventId = jdbc.queryForObject("""
                    select id from management_event
                    where tenant_id = :tenantId and source_event_id = :eventId and event_type = :eventType
                    """, key, UUID.class);
        }

        jdbc.update("""
                update event_consumer_inbox
                set status = 'PROCESSED', processed_at = now(), locked_by = null,
                    locked_until = null, last_error = null, row_version = row_version + 1
                where tenant_id = :tenantId and consumer_code = :consumerCode
                  and outbox_event_id = :eventId
                """, key);
        jdbc.update("""
                update outbox_event
                set status = 'PUBLISHED', published_at = now(), locked_by = null,
                    locked_until = null, last_error = null, row_version = row_version + 1
                where tenant_id = :tenantId and id = :eventId
                """, key);
        return new ProjectionResult(outboxEventId, managementEventId, "PUBLISHED", null);
    }

    private void markFailure(UUID tenantId, UUID outboxEventId, String error) {
        requiresNew.executeWithoutResult(status -> {
            databaseContext.apply(tenantId);
            jdbc.update("""
                    update outbox_event
                    set attempt_count = attempt_count + 1,
                        status = case when attempt_count + 1 >= :maxAttempts
                                      then 'DEAD_LETTER' else 'FAILED' end,
                        dead_lettered_at = case when attempt_count + 1 >= :maxAttempts
                                                then now() else dead_lettered_at end,
                        available_at = now() + make_interval(secs => case attempt_count + 1
                            when 1 then 5
                            when 2 then 30
                            when 3 then 120
                            else 600 end),
                        locked_by = null, locked_until = null,
                        last_error = :error, row_version = row_version + 1
                    where tenant_id = :tenantId and id = :eventId and status <> 'PUBLISHED'
                    """, new MapSqlParameterSource()
                    .addValue("tenantId", tenantId)
                    .addValue("eventId", outboxEventId)
                    .addValue("maxAttempts", MAX_ATTEMPTS)
                    .addValue("error", error));
        });
    }

    private JsonNode parse(Object value) {
        try {
            return objectMapper.readTree(value == null ? "{}" : value.toString());
        } catch (Exception exception) {
            throw new IllegalArgumentException("Outbox payload不是有效JSON", exception);
        }
    }

    private UUID optionalUuid(JsonNode payload, String... fieldNames) {
        for (String fieldName : fieldNames) {
            JsonNode value = payload.get(fieldName);
            if (value != null && !value.isNull() && !value.asText().isBlank()) {
                return UUID.fromString(value.asText());
            }
        }
        return null;
    }

    private String safeMessage(RuntimeException exception) {
        String value = exception.getMessage();
        if (value == null || value.isBlank()) {
            value = exception.getClass().getSimpleName();
        }
        return value.length() <= 4000 ? value : value.substring(0, 4000);
    }

    public record ProjectionResult(
            UUID outboxEventId,
            UUID managementEventId,
            String status,
            String error
    ) {
    }
}
