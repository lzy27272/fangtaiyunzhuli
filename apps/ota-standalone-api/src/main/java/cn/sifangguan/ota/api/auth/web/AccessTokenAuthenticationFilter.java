package cn.sifangguan.ota.api.auth.web;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.application.AuthenticationService;
import cn.sifangguan.ota.api.auth.application.InvalidAccessTokenException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public final class AccessTokenAuthenticationFilter extends OncePerRequestFilter {
    private static final String PREFIX = "Bearer ";
    private final AuthenticationService authenticationService;

    public AccessTokenAuthenticationFilter(AuthenticationService authenticationService) {
        this.authenticationService = authenticationService;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (authorization == null || !authorization.startsWith(PREFIX)) {
            filterChain.doFilter(request, response);
            return;
        }
        try {
            var authenticated = authenticationService.authenticateAccessToken(
                    authorization.substring(PREFIX.length()));
            AccountView account = AccountView.from(authenticated.account());
            var authorities = account.roles().stream()
                    .map(role -> new SimpleGrantedAuthority("ROLE_" + role.name()))
                    .toList();
            var principal = new AuthenticatedAccountPrincipal(account, authenticated.sessionId());
            var authentication = UsernamePasswordAuthenticationToken.authenticated(principal, null, authorities);
            SecurityContextHolder.getContext().setAuthentication(authentication);
            filterChain.doFilter(request, response);
        } catch (InvalidAccessTokenException exception) {
            SecurityContextHolder.clearContext();
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
            response.getWriter().write("{\"title\":\"Authentication required\",\"status\":401,\"code\":\"INVALID_ACCESS_TOKEN\"}");
        }
    }
}
