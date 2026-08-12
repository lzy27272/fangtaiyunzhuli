package cn.sifangguan.hotelaios.auth;

import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.IdentityAuthenticationException;
import cn.sifangguan.hotelaios.shared.security.PilotPasswordHasher;
import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.security.local-login.enabled", havingValue = "true")
public class PilotAuthService {
    private static final int MAX_FAILED_ATTEMPTS = 5;
    private static final Duration LOCK_DURATION = Duration.ofMinutes(15);

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final PilotPasswordHasher passwordHasher;
    private final JwtEncoder jwtEncoder;
    private final String issuer;
    private final String audience;
    private final Duration tokenTtl;
    private final AuditWriter auditWriter;

    public PilotAuthService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            PilotPasswordHasher passwordHasher,
            JwtEncoder jwtEncoder,
            AuditWriter auditWriter,
            @Value("${app.security.local-login.issuer:hotel-ai-os-pilot}") String issuer,
            @Value("${app.security.jwt.audience:hotel-ai-os-api}") String audience,
            @Value("${app.security.local-login.token-ttl-hours:8}") long tokenTtlHours
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.passwordHasher = passwordHasher;
        this.jwtEncoder = jwtEncoder;
        this.auditWriter = auditWriter;
        this.issuer = issuer;
        this.audience = audience;
        this.tokenTtl = Duration.ofHours(Math.max(1, Math.min(tokenTtlHours, 24)));
    }

    @Transactional
    public void changePassword(PilotAuthModels.ChangePasswordRequest request) {
        TenantPrincipal principal = TenantContext.require();
        databaseContext.apply(principal.tenantId());
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", principal.tenantId())
                .addValue("accountId", principal.actorId());
        String currentHash;
        try {
            currentHash = jdbc.queryForObject("""
                    select password_hash
                    from user_account
                    where tenant_id = :tenantId and id = :accountId and status = 'ACTIVE'
                    for update
                    """, parameters, String.class);
        } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
            throw new IdentityAuthenticationException("账号不存在或已停用");
        }
        if (!passwordHasher.matches(request.currentPassword(), currentHash)) {
            throw new IdentityAuthenticationException("当前密码错误");
        }
        passwordHasher.requirePassword(request.newPassword());
        if (passwordHasher.matches(request.newPassword(), currentHash)) {
            throw new IllegalArgumentException("新密码不能与当前密码相同");
        }
        jdbc.update("""
                update user_account
                set password_hash = :passwordHash,
                    password_changed_at = now(),
                    failed_login_attempts = 0,
                    locked_until = null,
                    updated_at = now()
                where tenant_id = :tenantId and id = :accountId
                """, parameters.addValue("passwordHash", passwordHasher.hash(request.newPassword())));
        auditWriter.record("PASSWORD_CHANGED", "USER_ACCOUNT", principal.actorId(),
                "{\"passwordChanged\":true,\"sessionRevocation\":\"CURRENT_CLIENT_LOGOUT\"}");
    }

    @Transactional(noRollbackFor = IdentityAuthenticationException.class)
    public PilotAuthModels.LoginResponse login(PilotAuthModels.LoginRequest request) {
        databaseContext.apply(request.tenantId());
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("tenantId", request.tenantId())
                .addValue("loginName", request.loginName().trim().toLowerCase());
        Map<String, Object> account;
        try {
            account = jdbc.queryForMap("""
                    select id, display_name, password_hash, failed_login_attempts, locked_until
                    from user_account
                    where tenant_id = :tenantId and lower(login_name) = :loginName and status = 'ACTIVE'
                    """, parameters);
        } catch (org.springframework.dao.EmptyResultDataAccessException exception) {
            throw new IdentityAuthenticationException("账号或密码错误");
        }

        UUID accountId = (UUID) account.get("id");
        OffsetDateTime lockedUntil = (OffsetDateTime) account.get("locked_until");
        if (lockedUntil != null && lockedUntil.isAfter(OffsetDateTime.now())) {
            throw new IdentityAuthenticationException("账号暂时锁定，请15分钟后重试");
        }

        String encoded = (String) account.get("password_hash");
        if (!passwordHasher.matches(request.password(), encoded)) {
            registerFailure(request.tenantId(), accountId, ((Number) account.get("failed_login_attempts")).intValue());
            throw new IdentityAuthenticationException("账号或密码错误");
        }

        jdbc.update("""
                update user_account
                set failed_login_attempts = 0, locked_until = null, last_login_at = now(), updated_at = now()
                where tenant_id = :tenantId and id = :accountId
                """, parameters.addValue("accountId", accountId));

        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(tokenTtl);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer)
                .issuedAt(issuedAt)
                .expiresAt(expiresAt)
                .subject(accountId.toString())
                .audience(java.util.List.of(audience))
                .claim("tenant_id", request.tenantId().toString())
                .claim("account_id", accountId.toString())
                .build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new PilotAuthModels.LoginResponse(
                token,
                "Bearer",
                OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC),
                accountId,
                String.valueOf(account.get("display_name"))
        );
    }

    private void registerFailure(UUID tenantId, UUID accountId, int currentFailures) {
        int next = currentFailures + 1;
        OffsetDateTime lock = next >= MAX_FAILED_ATTEMPTS ? OffsetDateTime.now().plus(LOCK_DURATION) : null;
        jdbc.update("""
                update user_account
                set failed_login_attempts = :attempts, locked_until = :lockedUntil, updated_at = now()
                where tenant_id = :tenantId and id = :accountId
                """, new MapSqlParameterSource()
                .addValue("tenantId", tenantId)
                .addValue("accountId", accountId)
                .addValue("attempts", next >= MAX_FAILED_ATTEMPTS ? 0 : next)
                .addValue("lockedUntil", lock));
    }
}
