package cn.sifangguan.ota.api.audit;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;

public class JdbcAuditPort implements AuditPort {
    private final JdbcTemplate jdbc;

    public JdbcAuditPort(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void append(AuditEvent event) {
        insert(event);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void appendInCurrentTransaction(AuditEvent event) {
        insert(event);
    }

    private void insert(AuditEvent event) {
        String actorType = event.actorAccountId() == null ? "ANONYMOUS" : "ACCOUNT";
        jdbc.update("""
                        insert into control.audit_event
                            (audit_event_id, occurred_at, actor_type, actor_account_id,
                             authentication_source_snapshot, action_code, resource_type,
                             resource_id, target_tenant_id, target_hotel_id, outcome_code,
                             coverage_code, condition_hash, trace_id, correlation_id,
                             failure_reason_code, created_at)
                        values (?, ?, ?, ?, 'LOCAL_PILOT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                event.id(), Timestamp.from(event.occurredAt()), actorType, event.actorAccountId(),
                actionCode(event.eventType()), resourceType(event), event.resourceId(),
                event.targetTenantId(), event.targetHotelId(), event.outcome(), event.coverageCode(),
                event.conditionHash(), CorrelationIdMapper.toUuid(event.correlationId()),
                CorrelationIdMapper.toUuid(event.correlationId()),
                event.reasonCode(), Timestamp.from(event.occurredAt()));
    }

    private static String resourceType(AuditEvent event) {
        if (event.resourceType() != null && !event.resourceType().isBlank()) {
            return event.resourceType();
        }
        return switch (event.eventType()) {
            case "AUTH_PLATFORM_ADMIN_BOOTSTRAPPED" -> "ACCOUNT";
            case "CROSS_TENANT_READ" -> "TENANT_COVERAGE";
            case "PRIVILEGED_TENANT_COMMAND" -> "TENANT_CONFIGURATION";
            default -> "AUTH_SESSION";
        };
    }

    private static String actionCode(String eventType) {
        return switch (eventType) {
            case "AUTH_LOGIN" -> "auth.login";
            case "AUTH_LOGIN_RATE_LIMITED" -> "auth.login.rate-limited";
            case "AUTH_REFRESH" -> "auth.refresh";
            case "AUTH_REFRESH_REUSE" -> "auth.refresh.reuse";
            case "AUTH_LOGOUT" -> "auth.logout";
            case "AUTH_ALL_SESSIONS_REVOKED" -> "auth.session.revoke-all";
            case "AUTH_PLATFORM_ADMIN_BOOTSTRAPPED" -> "auth.platform-admin.bootstrap";
            case "CROSS_TENANT_READ" -> "tenant.cross-read";
            case "PRIVILEGED_TENANT_COMMAND" -> "tenant.privileged-command";
            case "SPRINT2D_BROWSER_REHEARSAL_STARTED" ->
                    "ota.browser-authorization-rehearsal.start";
            case "SPRINT2D_BROWSER_REHEARSAL_CONFIRMED" ->
                    "ota.browser-authorization-rehearsal.complete";
            case "SPRINT2D_BROWSER_REHEARSAL_CANCELLED" ->
                    "ota.browser-authorization-rehearsal.cancel";
            case "SPRINT2D_BROWSER_REHEARSAL_REAUTHENTICATED" ->
                    "ota.browser-authorization-rehearsal.reauthenticate";
            default -> throw new IllegalArgumentException("Unsupported audit event type");
        };
    }
}
