package cn.sifangguan.hotelaios.integrations.wecom;

import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

/**
 * Opt-in delivery worker over the existing notification_delivery queue.
 * Application chats are selected only through active wecom_chat_binding rows
 * whose allowlist contains TASK_NOTIFICATION; otherwise the bound member is
 * messaged directly.
 */
@Component
@ConditionalOnProperty(name = {"app.wecom.enabled", "app.wecom.worker.enabled", "app.security.local-login.enabled"}, havingValue = "true")
public class WeComDeliveryWorker {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final TransactionTemplate transactions;
    private final WeComApiClient apiClient;
    private final WeComProperties properties;
    private final int batchSize;
    private final String workerId = "wecom-" + UUID.randomUUID();

    public WeComDeliveryWorker(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            TransactionTemplate transactions,
            WeComApiClient apiClient,
            WeComProperties properties,
            @Value("${app.wecom.worker.batch-size:50}") int batchSize
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.transactions = transactions;
        this.apiClient = apiClient;
        this.properties = properties;
        this.batchSize = Math.max(1, Math.min(batchSize, 200));
    }

    @Scheduled(
            fixedDelayString = "${app.wecom.worker.fixed-delay-ms:30000}",
            initialDelayString = "${app.wecom.worker.initial-delay-ms:30000}"
    )
    public void run() {
        enqueueTaskNotifications();
        for (Delivery delivery : claim()) {
            try {
                String endpoint = delivery.chatId() != null
                        ? "chat:" + delivery.chatId() : "user:" + delivery.userId();
                if (!MessageDigest.isEqual(
                        delivery.endpointHash().getBytes(StandardCharsets.US_ASCII),
                        sha256(properties.corpId() + ":" + endpoint).getBytes(StandardCharsets.US_ASCII))) {
                    throw new IllegalStateException("WeCom delivery endpoint binding changed");
                }
                URI deepLink = oauthStartLink(delivery.taskId());
                String externalMessageId = delivery.chatId() != null
                        ? apiClient.sendApplicationChatTaskLink(delivery.chatId(), delivery.title(), delivery.content(), deepLink)
                        : apiClient.sendApplicationTaskLink(delivery.userId(), delivery.title(), delivery.content(), deepLink);
                markSent(delivery.id(), externalMessageId);
            } catch (RuntimeException exception) {
                markFailed(delivery.id(), delivery.attemptCount() + 1, exception.getClass().getSimpleName());
            }
        }
    }

    private void enqueueTaskNotifications() {
        transactions.executeWithoutResult(status -> {
            prepare();
            List<PendingNotification> rows = jdbc.query("""
                    select n.id, n.recipient_account_id, ub.wecom_user_id,
                           chat.chat_id
                    from notification n
                    join management_task task
                      on n.source_type = 'TASK' and task.tenant_id = n.tenant_id and task.id = n.source_id
                    left join wecom_user_binding ub
                      on ub.tenant_id = n.tenant_id and ub.corp_id = :corpId
                     and ub.account_id = n.recipient_account_id and ub.status = 'ACTIVE'
                    left join lateral (
                        select cb.chat_id
                        from wecom_chat_binding cb
                        where cb.tenant_id = n.tenant_id and cb.corp_id = :corpId
                          and cb.org_unit_id = task.org_unit_id and cb.status = 'ACTIVE'
                          and cb.allowed_actions ? 'TASK_NOTIFICATION'
                          and case
                                when jsonb_typeof(task.source_snapshot #> '{delivery,wecomGroupShareable}') = 'boolean'
                                then (task.source_snapshot #>> '{delivery,wecomGroupShareable}')::boolean
                                else false
                              end
                        order by cb.created_at, cb.id
                        limit 1
                    ) chat on true
                    where n.tenant_id = :tenantId
                      and (ub.id is not null or chat.chat_id is not null)
                      and not exists (
                          select 1 from notification_delivery d
                          where d.tenant_id = n.tenant_id and d.notification_id = n.id and d.channel = 'WECHAT'
                      )
                    order by n.created_at, n.id
                    limit :batchSize
                    """, params().addValue("corpId", properties.corpId()).addValue("batchSize", batchSize),
                    (rs, rowNum) -> new PendingNotification(
                            rs.getObject("id", UUID.class), rs.getObject("recipient_account_id", UUID.class),
                            rs.getString("wecom_user_id"), rs.getString("chat_id")));
            for (PendingNotification row : rows) {
                String endpoint = row.chatId() != null ? "chat:" + row.chatId() : "user:" + row.userId();
                jdbc.update("""
                        insert into notification_delivery
                            (tenant_id, notification_id, channel, recipient_endpoint_hash, status)
                        values (:tenantId, :notificationId, 'WECHAT', :endpointHash, 'PENDING')
                        on conflict do nothing
                        """, params().addValue("notificationId", row.notificationId())
                        .addValue("endpointHash", sha256(properties.corpId() + ":" + endpoint)));
            }
        });
    }

    private List<Delivery> claim() {
        return transactions.execute(status -> {
            prepare();
            List<Delivery> rows = jdbc.query("""
                    select d.id, d.attempt_count, d.recipient_endpoint_hash,
                           n.title, n.content, n.source_id as task_id,
                           ub.wecom_user_id, chat.chat_id
                    from notification_delivery d
                    join notification n on n.tenant_id = d.tenant_id and n.id = d.notification_id
                    join management_task task
                      on n.source_type = 'TASK' and task.tenant_id = n.tenant_id and task.id = n.source_id
                    left join wecom_user_binding ub
                      on ub.tenant_id = n.tenant_id and ub.corp_id = :corpId
                     and ub.account_id = n.recipient_account_id and ub.status = 'ACTIVE'
                    left join lateral (
                        select cb.chat_id
                        from wecom_chat_binding cb
                        where cb.tenant_id = n.tenant_id and cb.corp_id = :corpId
                          and cb.org_unit_id = task.org_unit_id and cb.status = 'ACTIVE'
                          and cb.allowed_actions ? 'TASK_NOTIFICATION'
                          and case
                                when jsonb_typeof(task.source_snapshot #> '{delivery,wecomGroupShareable}') = 'boolean'
                                then (task.source_snapshot #>> '{delivery,wecomGroupShareable}')::boolean
                                else false
                              end
                        order by cb.created_at, cb.id limit 1
                    ) chat on true
                    where d.tenant_id = :tenantId and d.channel = 'WECHAT'
                      and d.status in ('PENDING', 'FAILED')
                      and d.available_at <= now() and (d.next_retry_at is null or d.next_retry_at <= now())
                      and (d.locked_until is null or d.locked_until < now())
                      and (ub.id is not null or chat.chat_id is not null)
                    order by d.available_at, d.created_at, d.id
                    for update of d skip locked
                    limit :batchSize
                    """, params().addValue("corpId", properties.corpId()).addValue("batchSize", batchSize),
                    (rs, rowNum) -> new Delivery(
                            rs.getObject("id", UUID.class), rs.getInt("attempt_count"),
                            rs.getString("title"), rs.getString("content"),
                            rs.getObject("task_id", UUID.class), rs.getString("recipient_endpoint_hash"),
                            rs.getString("wecom_user_id"),
                            rs.getString("chat_id")));
            for (Delivery row : rows) {
                jdbc.update("""
                        update notification_delivery
                        set locked_by = :workerId, locked_until = now() + interval '2 minutes'
                        where tenant_id = :tenantId and id = :id
                        """, params().addValue("id", row.id()).addValue("workerId", workerId));
            }
            return rows;
        });
    }

    private void markSent(UUID id, String externalMessageId) {
        transactions.executeWithoutResult(status -> {
            prepare();
            jdbc.update("""
                    update notification_delivery
                    set status = 'SENT', attempt_count = attempt_count + 1, sent_at = now(),
                        next_retry_at = null, locked_by = null, locked_until = null,
                        last_error = null, provider_message_id = :messageId,
                        row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id and locked_by = :workerId
                    """, params().addValue("id", id).addValue("workerId", workerId)
                    .addValue("messageId", externalMessageId));
        });
    }

    private void markFailed(UUID id, int attempts, String errorType) {
        long retryMinutes = Math.min(1440, 1L << Math.min(attempts, 10));
        transactions.executeWithoutResult(status -> {
            prepare();
            jdbc.update("""
                    update notification_delivery
                    set status = 'FAILED', attempt_count = attempt_count + 1, failed_at = now(),
                        next_retry_at = :nextRetryAt, locked_by = null, locked_until = null,
                        last_error = :errorType, row_version = row_version + 1
                    where tenant_id = :tenantId and id = :id and locked_by = :workerId
                    """, params().addValue("id", id).addValue("workerId", workerId)
                    .addValue("nextRetryAt", OffsetDateTime.now().plusMinutes(retryMinutes))
                    .addValue("errorType", errorType));
        });
    }

    private URI oauthStartLink(UUID taskId) {
        URI callback = properties.oauthCallbackUrl();
        URI start = UriComponentsBuilder.newInstance().scheme(callback.getScheme()).host(callback.getHost())
                .port(callback.getPort()).path("/api/v1/integrations/wecom/oauth/start")
                .queryParam("returnTo", "#/tasks?view=mine&taskId=" + taskId)
                .build().encode().toUri();
        return start;
    }

    private void prepare() { databaseContext.apply(properties.tenantId()); }
    private MapSqlParameterSource params() { return new MapSqlParameterSource("tenantId", properties.tenantId()); }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 is unavailable");
        }
    }

    private record PendingNotification(UUID notificationId, UUID accountId, String userId, String chatId) { }
    private record Delivery(UUID id, int attemptCount, String title, String content, UUID taskId,
                            String endpointHash, String userId, String chatId) { }
}
