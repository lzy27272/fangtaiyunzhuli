package cn.sifangguan.hotelaios.integrations.wecom;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = {"app.wecom.enabled", "app.security.local-login.enabled"}, havingValue = "true")
public class WeComSessionTokenIssuer {
    private final JwtEncoder jwtEncoder;
    private final WeComProperties properties;
    private final String issuer;
    private final String audience;

    public WeComSessionTokenIssuer(
            JwtEncoder jwtEncoder,
            WeComProperties properties,
            @Value("${app.security.local-login.issuer:hotel-ai-os-pilot}") String issuer,
            @Value("${app.security.jwt.audience:hotel-ai-os-api}") String audience
    ) {
        this.jwtEncoder = jwtEncoder;
        this.properties = properties;
        this.issuer = issuer;
        this.audience = audience;
    }

    public Session issue(UUID tenantId, UUID accountId) {
        Instant issuedAt = Instant.now();
        Instant expiresAt = issuedAt.plus(properties.sessionTtl());
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(issuer).issuedAt(issuedAt).expiresAt(expiresAt)
                .subject(accountId.toString()).audience(List.of(audience))
                .claim("tenant_id", tenantId.toString())
                .claim("account_id", accountId.toString())
                .claim("auth_source", "wecom")
                .build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(
                JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        return new Session(token, OffsetDateTime.ofInstant(expiresAt, ZoneOffset.UTC));
    }

    public record Session(String accessToken, OffsetDateTime expiresAt) { }
}
