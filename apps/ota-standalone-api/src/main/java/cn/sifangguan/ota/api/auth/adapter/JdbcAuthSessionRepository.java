package cn.sifangguan.ota.api.auth.adapter;

import cn.sifangguan.ota.api.auth.domain.AuthSession;
import cn.sifangguan.ota.api.auth.port.AuthSessionRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public class JdbcAuthSessionRepository implements AuthSessionRepository {
    private static final String SELECT_COLUMNS = """
            select session_id, session_family_id, account_id, refresh_token_hash,
                   authz_version_snapshot, issued_at, expires_at, rotated_at,
                   replaced_by_session_id, revoked_at, revoke_reason_code
              from control.auth_session
            """;

    private final JdbcTemplate jdbc;

    public JdbcAuthSessionRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    @Transactional
    public void create(AuthSession session) {
        insert(session);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AuthSession> findByTokenHash(String tokenHash) {
        return query(SELECT_COLUMNS + " where refresh_token_hash = ?", tokenHash).stream().findFirst();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AuthSession> findById(UUID sessionId) {
        return query(SELECT_COLUMNS + " where session_id = ?", sessionId).stream().findFirst();
    }

    @Override
    @Transactional
    public RotationResult rotate(String currentTokenHash, AuthSession replacement, Instant rotatedAt) {
        List<AuthSession> current = query(
                SELECT_COLUMNS + " where refresh_token_hash = ? for update", currentTokenHash);
        if (current.isEmpty()) {
            return RotationResult.MISSING;
        }
        AuthSession prior = current.getFirst();
        if (prior.isConsumedOrRevoked()) {
            return RotationResult.ALREADY_CONSUMED_OR_REVOKED;
        }
        insert(replacement);
        int changed = jdbc.update("""
                        update control.auth_session
                           set rotated_at = ?, replaced_by_session_id = ?
                         where session_id = ? and rotated_at is null and revoked_at is null
                        """,
                Timestamp.from(rotatedAt), replacement.id(), prior.id());
        return changed == 1 ? RotationResult.ROTATED : RotationResult.ALREADY_CONSUMED_OR_REVOKED;
    }

    @Override
    @Transactional
    public void revokeFamily(UUID familyId, Instant revokedAt, String reason) {
        boolean reuse = "REFRESH_REUSE_DETECTED".equals(reason);
        jdbc.update("""
                        update control.auth_session
                           set revoked_at = coalesce(revoked_at, ?),
                               revoke_reason_code = coalesce(revoke_reason_code, ?),
                               reuse_detected_at = case when ? then coalesce(reuse_detected_at, ?) else reuse_detected_at end
                         where session_family_id = ?
                        """,
                Timestamp.from(revokedAt), reason, reuse, Timestamp.from(revokedAt), familyId);
    }

    @Override
    @Transactional
    public void revokeAllForAccount(UUID accountId, Instant revokedAt, String reason) {
        jdbc.update("""
                        update control.auth_session
                           set revoked_at = coalesce(revoked_at, ?),
                               revoke_reason_code = coalesce(revoke_reason_code, ?)
                         where account_id = ?
                        """,
                Timestamp.from(revokedAt), reason, accountId);
    }

    private void insert(AuthSession session) {
        jdbc.update("""
                        insert into control.auth_session
                            (session_id, account_id, session_family_id, refresh_token_hash,
                             authz_version_snapshot, issued_at, expires_at, rotated_at,
                             replaced_by_session_id, revoked_at, revoke_reason_code)
                        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                session.id(), session.accountId(), session.familyId(), session.refreshTokenHash(),
                session.accountAuthzVersion(), Timestamp.from(session.issuedAt()), Timestamp.from(session.expiresAt()),
                timestampOrNull(session.rotatedAt()), session.replacedBySessionId(),
                timestampOrNull(session.revokedAt()), session.revokedReason());
    }

    private List<AuthSession> query(String sql, Object... parameters) {
        return jdbc.query(sql, (rs, row) -> new AuthSession(
                rs.getObject("session_id", UUID.class),
                rs.getObject("session_family_id", UUID.class),
                rs.getObject("account_id", UUID.class),
                rs.getString("refresh_token_hash"),
                rs.getLong("authz_version_snapshot"),
                rs.getTimestamp("issued_at").toInstant(),
                rs.getTimestamp("expires_at").toInstant(),
                instantOrNull(rs.getTimestamp("rotated_at")),
                rs.getObject("replaced_by_session_id", UUID.class),
                instantOrNull(rs.getTimestamp("revoked_at")),
                rs.getString("revoke_reason_code")), parameters);
    }

    private static Instant instantOrNull(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Timestamp timestampOrNull(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }
}
