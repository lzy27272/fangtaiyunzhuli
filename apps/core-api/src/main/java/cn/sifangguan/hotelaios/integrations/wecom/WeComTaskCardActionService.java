package cn.sifangguan.hotelaios.integrations.wecom;

import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.tasks.TaskModels;
import cn.sifangguan.hotelaios.tasks.TaskService;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Converts an opaque, server-issued card event key into an existing TaskService
 * command. No task id, assignment, action or row version from the callback body
 * is trusted.
 */
@Service
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComTaskCardActionService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final TaskService taskService;
    private final WeComProperties properties;

    public WeComTaskCardActionService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            TaskService taskService,
            WeComProperties properties
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.taskService = taskService;
        this.properties = properties;
    }

    @Transactional
    public Map<String, Object> execute(
            WeComIdentityResolver.ResolvedIdentity identity,
            UUID receiptId,
            String eventKey
    ) {
        if (eventKey == null || eventKey.isBlank()) {
            throw new IllegalArgumentException("WeCom task-card event misses its opaque event key");
        }
        TenantPrincipal principal = identity.principal();
        if (!principal.tenantId().equals(properties.tenantId())) {
            throw new IllegalArgumentException("Resolved WeCom identity belongs to another tenant");
        }
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantContext.set(principal);
        try {
            databaseContext.apply(principal.tenantId());
            List<CardBinding> rows = jdbc.query("""
                    select id, task_id, recipient_account_id, recipient_assignment_id,
                           allowed_command, expected_task_version, status, expires_at, row_version
                    from wecom_task_card_binding
                    where tenant_id = :tenantId and external_event_key = :eventKey
                    for update
                    """, params().addValue("eventKey", eventKey.trim()), (rs, rowNum) -> new CardBinding(
                    rs.getObject("id", UUID.class), rs.getObject("task_id", UUID.class),
                    rs.getObject("recipient_account_id", UUID.class),
                    rs.getObject("recipient_assignment_id", UUID.class),
                    rs.getString("allowed_command"), rs.getLong("expected_task_version"),
                    rs.getString("status"), rs.getObject("expires_at", java.time.OffsetDateTime.class),
                    rs.getLong("row_version")
            ));
            if (rows.size() != 1) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Task card is unknown");
            CardBinding card = rows.getFirst();
            if (!principal.actorId().equals(card.recipientAccountId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Task card belongs to another account");
            }
            if (!"ACTIVE".equals(card.status())) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Task card was already handled or revoked");
            }
            if (!card.expiresAt().isAfter(java.time.OffsetDateTime.now())) {
                jdbc.update("""
                        update wecom_task_card_binding
                        set status = 'EXPIRED', row_version = row_version + 1
                        where tenant_id = :tenantId and id = :id and status = 'ACTIVE'
                        """, params().addValue("id", card.id()));
                throw new ResponseStatusException(HttpStatus.GONE, "Task card has expired");
            }
            UUID actorAssignmentId = identity.chooseAssignment(card.recipientAssignmentId());
            var payload = JsonNodeFactory.instance.objectNode()
                    .put("channel", "WECOM_BOT")
                    .put("receiptId", receiptId.toString());
            Map<String, Object> result = taskService.command(
                    card.taskId(),
                    card.allowedCommand(),
                    "wecom-card:" + receiptId + ":" + card.id(),
                    new TaskModels.Command(card.expectedTaskVersion(), actorAssignmentId, payload)
            );
            int consumed = jdbc.update("""
                    update wecom_task_card_binding
                    set status = 'CONSUMED', consumed_by_account_id = :accountId,
                        consumed_by_assignment_id = :assignmentId, consumed_receipt_id = :receiptId,
                        consumed_at = now(), row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id and status = 'ACTIVE'
                      and row_version = :rowVersion
                    """, params()
                    .addValue("id", card.id())
                    .addValue("accountId", principal.actorId())
                    .addValue("assignmentId", actorAssignmentId)
                    .addValue("receiptId", receiptId)
                    .addValue("rowVersion", card.rowVersion()));
            if (consumed != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "Task card changed concurrently");
            return result;
        } finally {
            if (previous == null) TenantContext.clear(); else TenantContext.set(previous);
        }
    }

    private MapSqlParameterSource params() {
        return new MapSqlParameterSource("tenantId", properties.tenantId());
    }

    private record CardBinding(
            UUID id,
            UUID taskId,
            UUID recipientAccountId,
            UUID recipientAssignmentId,
            String allowedCommand,
            long expectedTaskVersion,
            String status,
            java.time.OffsetDateTime expiresAt,
            long rowVersion
    ) { }
}
