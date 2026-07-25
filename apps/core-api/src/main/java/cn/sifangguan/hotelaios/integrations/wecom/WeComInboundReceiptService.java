package cn.sifangguan.hotelaios.integrations.wecom;

import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComInboundReceiptService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final WeComProperties properties;

    public WeComInboundReceiptService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            WeComProperties properties
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.properties = properties;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Reservation reserve(WeComInboundMessage callback, UUID correlationId) {
        databaseContext.apply(properties.tenantId());
        UUID id = UUID.randomUUID();
        int inserted;
        try {
            inserted = jdbc.update("""
                    insert into wecom_inbound_receipt
                        (id, tenant_id, corp_id, message_id, receipt_type, from_user_id,
                         event_key, payload_hash, status, correlation_id)
                    values
                        (:id, :tenantId, :corpId, :messageId, :receiptType, :fromUserId,
                         :eventKey, :payloadHash, 'PROCESSING', :correlationId)
                    on conflict (tenant_id, corp_id, message_id) do nothing
                    """, params()
                    .addValue("id", id)
                    .addValue("messageId", callback.messageId())
                    .addValue("receiptType", callback.receiptType())
                    .addValue("fromUserId", callback.fromUserId())
                    .addValue("eventKey", callback.eventKey())
                    .addValue("payloadHash", callback.payloadHash())
                    .addValue("correlationId", correlationId));
        } catch (DuplicateKeyException exception) {
            inserted = 0;
        }
        if (inserted == 1) return new Reservation(id, false, "PROCESSING");

        List<Existing> existing = jdbc.query("""
                select id, payload_hash, status
                from wecom_inbound_receipt
                where tenant_id = :tenantId and corp_id = :corpId and message_id = :messageId
                """, params().addValue("messageId", callback.messageId()), (rs, rowNum) -> new Existing(
                rs.getObject("id", UUID.class), rs.getString("payload_hash"), rs.getString("status")));
        if (existing.size() != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "WeCom receipt state is unavailable");
        Existing row = existing.getFirst();
        if (!row.payloadHash().equals(callback.payloadHash())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "A WeCom MsgId was reused with a different payload");
        }
        return new Reservation(row.id(), true, row.status());
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public boolean begin(UUID receiptId) {
        databaseContext.apply(properties.tenantId());
        return jdbc.update("""
                update wecom_inbound_receipt
                set status = 'PROCESSING', attempt_count = attempt_count + 1,
                    last_attempt_at = now(), processed_at = null, last_error = null,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id
                  and status = 'PROCESSING' and last_attempt_at is null
                """, params().addValue("id", receiptId)) == 1;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public List<Recovery> claimRecoverable(int limit) {
        databaseContext.apply(properties.tenantId());
        return jdbc.query("""
                with candidates as (
                    select id from wecom_inbound_receipt
                    where tenant_id = :tenantId
                      and event_key is not null and from_user_id is not null
                      and (
                        status = 'FAILED'
                        or (status = 'PROCESSING' and (
                            (last_attempt_at is null and received_at < now() - interval '1 minute')
                            or last_attempt_at < now() - interval '1 minute'
                        ))
                      )
                      and attempt_count < 8
                    order by received_at, id
                    for update skip locked
                    limit :limit
                )
                update wecom_inbound_receipt receipt
                set status = 'PROCESSING', attempt_count = receipt.attempt_count + 1,
                    last_attempt_at = now(), processed_at = null, last_error = null,
                    row_version = receipt.row_version + 1
                from candidates
                where receipt.tenant_id = :tenantId and receipt.id = candidates.id
                returning receipt.id, receipt.from_user_id, receipt.event_key, receipt.correlation_id
                """, params().addValue("limit", Math.max(1, Math.min(limit, 100))),
                (rs, rowNum) -> new Recovery(
                        rs.getObject("id", UUID.class), rs.getString("from_user_id"),
                        rs.getString("event_key"), rs.getObject("correlation_id", UUID.class)));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void complete(UUID receiptId, String status) {
        if (!List.of("SUCCEEDED", "IGNORED").contains(status)) throw new IllegalArgumentException("Invalid receipt outcome");
        databaseContext.apply(properties.tenantId());
        jdbc.update("""
                update wecom_inbound_receipt
                set status = :status, processed_at = now(), last_error = null, row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and status = 'PROCESSING'
                """, params().addValue("id", receiptId).addValue("status", status));
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void fail(UUID receiptId, RuntimeException exception) {
        databaseContext.apply(properties.tenantId());
        String message = exception.getClass().getSimpleName();
        jdbc.update("""
                update wecom_inbound_receipt
                set status = 'FAILED', processed_at = now(), last_error = :error,
                    row_version = row_version + 1
                where tenant_id = :tenantId and id = :id and status = 'PROCESSING'
                """, params().addValue("id", receiptId).addValue("error", message));
    }

    private MapSqlParameterSource params() {
        return new MapSqlParameterSource()
                .addValue("tenantId", properties.tenantId())
                .addValue("corpId", properties.corpId());
    }

    private record Existing(UUID id, String payloadHash, String status) { }
    public record Reservation(UUID id, boolean duplicate, String status) { }
    public record Recovery(UUID id, String fromUserId, String eventKey, UUID correlationId) { }
}
