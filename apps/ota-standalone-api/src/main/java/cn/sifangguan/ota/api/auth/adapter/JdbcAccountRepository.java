package cn.sifangguan.ota.api.auth.adapter;

import cn.sifangguan.ota.api.auth.domain.AccountCredential;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.AccountWithCredential;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.port.AccountRepository;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

public class JdbcAccountRepository implements AccountRepository {
    private static final long FIRST_ADMIN_BOOTSTRAP_LOCK = 0x4f54415f41444d49L;
    private final JdbcTemplate jdbc;
    private final int maxLoginFailures;
    private final Duration lockDuration;

    public JdbcAccountRepository(JdbcTemplate jdbc, int maxLoginFailures, Duration lockDuration) {
        this.jdbc = jdbc;
        this.maxLoginFailures = maxLoginFailures;
        this.lockDuration = lockDuration;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AccountWithCredential> findForLogin(String canonicalUsername) {
        List<UUID> ids = jdbc.query(
                "select account_id from control.auth_account where login_name = ?",
                (rs, row) -> rs.getObject("account_id", UUID.class), canonicalUsername);
        if (ids.isEmpty()) {
            return Optional.empty();
        }
        LocalAccount account = findById(ids.getFirst()).orElseThrow();
        try {
            AccountCredential credential = jdbc.queryForObject("""
                            select account_id, password_hash, algorithm_code, failed_attempt_count, locked_until
                              from control.auth_credential
                             where account_id = ? and status = 'ACTIVE' and retired_at is null
                             order by created_at desc
                             limit 1
                            """,
                    (rs, row) -> new AccountCredential(
                            rs.getObject("account_id", UUID.class),
                            rs.getString("password_hash"),
                            rs.getString("algorithm_code"),
                            rs.getInt("failed_attempt_count"),
                            instantOrNull(rs.getTimestamp("locked_until"))),
                    account.id());
            return Optional.of(new AccountWithCredential(account, credential));
        } catch (EmptyResultDataAccessException exception) {
            return Optional.empty();
        }
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<LocalAccount> findById(UUID accountId) {
        List<AccountRow> result = jdbc.query("""
                        select account_id, login_name, display_name, status, authz_version
                          from control.auth_account
                         where account_id = ?
                        """,
                (rs, row) -> new AccountRow(
                        rs.getObject("account_id", UUID.class),
                        rs.getString("login_name"),
                        rs.getString("display_name"),
                        AccountStatus.valueOf(rs.getString("status")),
                        rs.getLong("authz_version")),
                accountId);
        return result.stream().findFirst().map(row -> new LocalAccount(
                row.id(), row.username(), row.displayName(), row.status(), row.authzVersion(),
                loadRoles(row.id())));
    }

    @Override
    @Transactional(readOnly = true)
    public boolean hasAnyAccount() {
        return Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists(select 1 from control.auth_account)", Boolean.class));
    }

    @Override
    @Transactional
    public void createPlatformAdmin(LocalAccount account, AccountCredential credential) {
        // Transaction-scoped PostgreSQL advisory lock makes the empty-database check and
        // first-account insert one serialized operation across all API replicas.
        jdbc.query(
                "select pg_advisory_xact_lock(?)",
                statement -> statement.setLong(1, FIRST_ADMIN_BOOTSTRAP_LOCK),
                resultSet -> null);
        if (Boolean.TRUE.equals(jdbc.queryForObject(
                "select exists(select 1 from control.auth_account)", Boolean.class))) {
            throw new IllegalStateException("Bootstrap is allowed only when no account exists");
        }
        Instant now = Instant.now();
        jdbc.update("""
                        insert into control.auth_account
                            (account_id, login_name, display_name, status, authz_version, created_at, updated_at)
                        values (?, ?, ?, ?, ?, ?, ?)
                        """,
                account.id(), account.username(), account.displayName(), account.status().name(),
                account.authzVersion(), Timestamp.from(now), Timestamp.from(now));
        jdbc.update("""
                        insert into control.auth_credential
                            (credential_id, account_id, password_hash, algorithm_code, algorithm_version,
                             failed_attempt_count, status, created_at)
                        values (?, ?, ?, 'ARGON2ID', 'argon2id-v1', 0, 'ACTIVE', ?)
                        """,
                UUID.randomUUID(), account.id(), credential.passwordHash(), Timestamp.from(now));
        UUID roleId = jdbc.queryForObject(
                "select role_id from control.role_definition where role_code = 'PLATFORM_ADMIN'",
                UUID.class);
        jdbc.update("""
                        insert into control.account_role
                            (account_role_id, account_id, role_id, valid_from, grant_reason_code, created_at)
                        values (?, ?, ?, ?, 'INITIAL_OFFLINE_BOOTSTRAP', ?)
                        """,
                UUID.randomUUID(), account.id(), roleId, Timestamp.from(now), Timestamp.from(now));
    }

    @Override
    @Transactional
    public void recordLoginFailure(UUID accountId, Instant attemptedAt) {
        jdbc.update("""
                        update control.auth_credential
                           set failed_attempt_count = failed_attempt_count + 1,
                               locked_until = case
                                   when failed_attempt_count + 1 >= ? then ?
                                   else locked_until
                               end
                         where account_id = ? and status = 'ACTIVE' and retired_at is null
                        """,
                maxLoginFailures, Timestamp.from(attemptedAt.plus(lockDuration)), accountId);
    }

    @Override
    @Transactional
    public void recordLoginSuccess(UUID accountId) {
        jdbc.update("""
                        update control.auth_credential
                           set failed_attempt_count = 0, locked_until = null
                         where account_id = ? and status = 'ACTIVE' and retired_at is null
                        """,
                accountId);
    }

    private Set<OtaRole> loadRoles(UUID accountId) {
        return jdbc.query("""
                        select rd.role_code
                          from control.account_role ar
                          join control.role_definition rd on rd.role_id = ar.role_id
                         where ar.account_id = ?
                           and ar.valid_from <= now()
                           and (ar.valid_until is null or ar.valid_until > now())
                        """,
                (rs, row) -> OtaRole.valueOf(rs.getString("role_code")), accountId)
                .stream().collect(Collectors.toUnmodifiableSet());
    }

    private static Instant instantOrNull(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Timestamp timestampOrNull(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    private record AccountRow(
            UUID id,
            String username,
            String displayName,
            AccountStatus status,
            long authzVersion
    ) {
    }
}
