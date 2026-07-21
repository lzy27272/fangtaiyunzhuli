package cn.sifangguan.hotelaios.shared.context;

import cn.sifangguan.hotelaios.shared.security.EffectiveIdentityService;
import cn.sifangguan.hotelaios.shared.security.IdentityAuthenticationException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
public class TenantContextFilter extends OncePerRequestFilter {
    private final boolean developmentHeaderAuthEnabled;
    private final EffectiveIdentityService identityService;
    private final String tenantIdClaim;
    private final String accountIdClaim;
    private final boolean legacyUnitMode;

    @Autowired
    public TenantContextFilter(
            @Value("${app.security.development-header-auth-enabled:false}") boolean developmentHeaderAuthEnabled,
            @Value("${app.security.jwt.tenant-id-claim:tenant_id}") String tenantIdClaim,
            @Value("${app.security.jwt.account-id-claim:account_id}") String accountIdClaim,
            EffectiveIdentityService identityService
    ) {
        this.developmentHeaderAuthEnabled = developmentHeaderAuthEnabled;
        this.identityService = identityService;
        this.tenantIdClaim = tenantIdClaim;
        this.accountIdClaim = accountIdClaim;
        this.legacyUnitMode = false;
    }

    /** Compatibility constructor used only by the isolated Sprint 1 filter tests. */
    public TenantContextFilter(boolean developmentHeaderAuthEnabled) {
        this.developmentHeaderAuthEnabled = developmentHeaderAuthEnabled;
        this.identityService = null;
        this.tenantIdClaim = "tenant_id";
        this.accountIdClaim = "account_id";
        this.legacyUnitMode = true;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getRequestURI().startsWith("/actuator/")
                || request.getRequestURI().equals("/api/v1/auth/login")
                || HttpMethod.OPTIONS.matches(request.getMethod());
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        try {
            UUID correlationId = optionalUuid(request.getHeader("X-Correlation-Id"), UUID.randomUUID());
            TenantPrincipal principal = developmentHeaderAuthEnabled
                    ? resolveDevelopmentIdentity(request, correlationId)
                    : resolveJwtIdentity(correlationId);

            TenantContext.set(principal);
            response.setHeader("X-Correlation-Id", correlationId.toString());
            filterChain.doFilter(request, response);
        } catch (IdentityAuthenticationException exception) {
            writeProblem(response, HttpStatus.UNAUTHORIZED, "身份认证失败", exception.getMessage());
        } catch (IllegalArgumentException exception) {
            writeProblem(response, HttpStatus.BAD_REQUEST, "无效的身份上下文", exception.getMessage());
        } finally {
            TenantContext.clear();
        }
    }

    private TenantPrincipal resolveDevelopmentIdentity(HttpServletRequest request, UUID correlationId) {
        UUID tenantId = requiredUuid(request, "X-Tenant-Id");
        UUID actorId = requiredUuid(request, "X-Actor-Id");
        if (!legacyUnitMode) {
            return identityService.resolve(tenantId, actorId, correlationId);
        }

        String roleCode = requiredHeader(request, "X-Role-Code").trim().toUpperCase();
        Set<UUID> scopes = parseScopes(request.getHeader("X-Org-Scope"));
        return new TenantPrincipal(tenantId, actorId, roleCode, scopes, correlationId);
    }

    private TenantPrincipal resolveJwtIdentity(UUID correlationId) {
        if (legacyUnitMode) {
            throw new IdentityAuthenticationException("开发请求头认证已关闭");
        }
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (!(authentication instanceof JwtAuthenticationToken jwtAuthentication)
                || !authentication.isAuthenticated()) {
            throw new IdentityAuthenticationException("需要有效的Bearer JWT");
        }
        Object tenantClaim = jwtAuthentication.getToken().getClaims().get(tenantIdClaim);
        Object accountClaim = jwtAuthentication.getToken().getClaims().get(accountIdClaim);
        if (accountClaim == null) {
            accountClaim = jwtAuthentication.getToken().getSubject();
        }
        if (tenantClaim == null || accountClaim == null) {
            throw new IdentityAuthenticationException("JWT缺少租户或账号标识");
        }
        try {
            return identityService.resolve(
                    UUID.fromString(tenantClaim.toString()),
                    UUID.fromString(accountClaim.toString()),
                    correlationId
            );
        } catch (IllegalArgumentException exception) {
            throw new IdentityAuthenticationException("JWT租户或账号标识不是有效UUID");
        }
    }

    private UUID requiredUuid(HttpServletRequest request, String name) {
        return UUID.fromString(requiredHeader(request, name));
    }

    private String requiredHeader(HttpServletRequest request, String name) {
        String value = request.getHeader(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("缺少请求头 " + name);
        }
        return value;
    }

    private UUID optionalUuid(String value, UUID fallback) {
        return value == null || value.isBlank() ? fallback : UUID.fromString(value);
    }

    private Set<UUID> parseScopes(String value) {
        if (value == null || value.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(value.split(","))
                .map(String::trim)
                .filter(item -> !item.isBlank())
                .map(UUID::fromString)
                .collect(Collectors.toUnmodifiableSet());
    }

    private void writeProblem(
            HttpServletResponse response,
            HttpStatus status,
            String title,
            String detail
    ) throws IOException {
        response.setStatus(status.value());
        response.setContentType("application/problem+json;charset=UTF-8");
        response.getWriter().write("{\"title\":\"" + escape(title) + "\",\"detail\":\""
                + escape(detail) + "\"}");
    }

    private String escape(String value) {
        return value == null ? "" : value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
