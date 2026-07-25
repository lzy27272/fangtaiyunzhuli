package cn.sifangguan.hotelaios.shared.security;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import javax.sql.DataSource;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class SignedJwtIdentityLifecycleIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String AUDIENCE = "hotel-ai-os-api";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String HOUSEKEEPING_SUPERVISOR = "19000000-0000-0000-0000-000000000004";
    private static final String FRONT_OFFICE_SUPERVISOR = "19000000-0000-0000-0000-000000000005";
    private static final String HANGZHOU_HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String SHANGHAI_HOTEL = "12000000-0000-0000-0000-000000000004";
    private static final String HOUSEKEEPING_ASSIGNMENT = "19200000-0000-0000-0000-000000000003";
    private static final String FRONT_OFFICE_SECONDARY_ASSIGNMENT = "19200000-0000-0000-0000-000000000005";
    private static final String FRONT_OFFICE_PRIMARY_ASSIGNMENT = "19200000-0000-0000-0000-000000000004";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource OWNER_DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(OWNER_DATA_SOURCE);
    private static final TestOidcIssuer OIDC = TestOidcIssuer.start();

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> false);
        registry.add("app.security.jwt.issuer-uri", OIDC::issuer);
        registry.add("app.security.jwt.audience", () -> AUDIENCE);
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.automation.worker.enabled", () -> false);
        registry.add("app.work-expectation.sla.scheduler-enabled", () -> false);
    }

    @AfterAll
    static void closeResources() throws Exception {
        OIDC.close();
        POSTGRES.close();
    }

    @Test
    void stillValidSignedJwtIsRejectedImmediatelyAfterAccountIsDisabled() throws Exception {
        String token = OIDC.sign(FRONT_DESK);
        assertStillUnexpired(token);
        getMe(token, 200);

        updateAccountStatus(FRONT_DESK, "INACTIVE");
        try {
            assertStillUnexpired(token);
            getMe(token, 401);
        } finally {
            updateAccountStatus(FRONT_DESK, "ACTIVE");
        }
    }

    @Test
    void stillValidSignedJwtIsRejectedAfterLastCurrentAssignmentIsRevoked() throws Exception {
        String token = OIDC.sign(HOUSEKEEPING_SUPERVISOR);
        assertStillUnexpired(token);
        getMe(token, 200);

        updateAssignmentStatus(HOUSEKEEPING_ASSIGNMENT, "INACTIVE");
        try {
            assertStillUnexpired(token);
            getMe(token, 401);
        } finally {
            updateAssignmentStatus(HOUSEKEEPING_ASSIGNMENT, "ACTIVE");
        }
    }

    @Test
    void onePersonWithAnotherCurrentAssignmentRemainsAuthenticated() throws Exception {
        String token = OIDC.sign(FRONT_OFFICE_SUPERVISOR);
        getMe(token, 200);

        updateAssignmentStatus(FRONT_OFFICE_SECONDARY_ASSIGNMENT, "INACTIVE");
        try {
            assertStillUnexpired(token);
            mockMvc.perform(get("/api/v1/iam/me")
                            .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.positionAssignments.length()").value(1))
                    .andExpect(jsonPath("$.positionAssignments[0].id").value(FRONT_OFFICE_PRIMARY_ASSIGNMENT));
        } finally {
            updateAssignmentStatus(FRONT_OFFICE_SECONDARY_ASSIGNMENT, "ACTIVE");
        }
    }

    @Test
    void businessDayAllowsOwnSecondaryAssignmentOrgButRejectsUnrelatedHotel() throws Exception {
        String token = OIDC.sign(FRONT_OFFICE_SUPERVISOR);

        mockMvc.perform(get("/api/v1/business-days/current")
                        .param("orgUnitId", HANGZHOU_HOTEL)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hotelOrgUnitId").value(HANGZHOU_HOTEL))
                .andExpect(jsonPath("$.orgUnitId").value(HANGZHOU_HOTEL));

        mockMvc.perform(get("/api/v1/business-days/current")
                        .param("orgUnitId", SHANGHAI_HOTEL)
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isForbidden());
    }

    @Test
    void tenantAccountWithoutEmployeeRecordRemainsAuthenticated() throws Exception {
        String token = OIDC.sign(CEO);
        assertStillUnexpired(token);
        getMe(token, 200);
    }

    private void getMe(String token, int expectedStatus) throws Exception {
        mockMvc.perform(get("/api/v1/iam/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().is(expectedStatus));
    }

    private static void assertStillUnexpired(String token) throws Exception {
        Date expiration = SignedJWT.parse(token).getJWTClaimsSet().getExpirationTime();
        assertThat(expiration).isAfter(Date.from(Instant.now()));
    }

    private static void updateAccountStatus(String accountId, String status) {
        ownerJdbc().update("""
                update user_account
                set status = ?
                where tenant_id = ?::uuid and id = ?::uuid
                """, status, TENANT, accountId);
    }

    private static void updateAssignmentStatus(String assignmentId, String status) {
        ownerJdbc().update("""
                update employee_position_assignment
                set status = ?
                where tenant_id = ?::uuid and id = ?::uuid
                """, status, TENANT, assignmentId);
    }

    private static JdbcTemplate ownerJdbc() {
        return new JdbcTemplate(OWNER_DATA_SOURCE);
    }

    private static EmbeddedPostgres startPostgres() {
        try {
            return EmbeddedPostgres.builder().start();
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static String jdbcUrl(DataSource dataSource) {
        try (Connection connection = dataSource.getConnection()) {
            return connection.getMetaData().getURL();
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }

    private static final class TestOidcIssuer implements AutoCloseable {
        private final HttpServer server;
        private final RSAKey signingKey;
        private final String issuer;

        private TestOidcIssuer(HttpServer server, RSAKey signingKey, String issuer) {
            this.server = server;
            this.signingKey = signingKey;
            this.issuer = issuer;
        }

        static TestOidcIssuer start() {
            try {
                RSAKey signingKey = new RSAKeyGenerator(2048)
                        .keyID("identity-lifecycle-test")
                        .generate();
                HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
                String issuer = "http://127.0.0.1:" + server.getAddress().getPort();
                server.createContext("/.well-known/openid-configuration", exchange -> respond(exchange, """
                        {
                          "issuer":"%s",
                          "jwks_uri":"%s/jwks.json",
                          "authorization_endpoint":"%s/authorize",
                          "token_endpoint":"%s/token",
                          "response_types_supported":["token"],
                          "subject_types_supported":["public"],
                          "id_token_signing_alg_values_supported":["RS256"]
                        }
                        """.formatted(issuer, issuer, issuer, issuer)));
                server.createContext("/jwks.json", exchange -> respond(exchange,
                        "{\"keys\":[" + signingKey.toPublicJWK().toJSONString() + "]}"));
                server.start();
                return new TestOidcIssuer(server, signingKey, issuer);
            } catch (Exception exception) {
                throw new ExceptionInInitializerError(exception);
            }
        }

        String issuer() {
            return issuer;
        }

        String sign(String accountId) throws Exception {
            Instant now = Instant.now();
            JWTClaimsSet claims = new JWTClaimsSet.Builder()
                    .issuer(issuer)
                    .audience(AUDIENCE)
                    .subject(accountId)
                    .claim("tenant_id", TENANT)
                    .claim("account_id", accountId)
                    .issueTime(Date.from(now))
                    .notBeforeTime(Date.from(now.minus(1, ChronoUnit.SECONDS)))
                    .expirationTime(Date.from(now.plus(10, ChronoUnit.MINUTES)))
                    .jwtID(UUID.randomUUID().toString())
                    .build();
            SignedJWT jwt = new SignedJWT(
                    new JWSHeader.Builder(JWSAlgorithm.RS256)
                            .type(JOSEObjectType.JWT)
                            .keyID(signingKey.getKeyID())
                            .build(),
                    claims
            );
            jwt.sign(new RSASSASigner(signingKey));
            return jwt.serialize();
        }

        @Override
        public void close() {
            server.stop(0);
        }

        private static void respond(HttpExchange exchange, String json) throws IOException {
            byte[] body = json.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json;charset=UTF-8");
            exchange.sendResponseHeaders(200, body.length);
            try (var output = exchange.getResponseBody()) {
                output.write(body);
            }
        }
    }
}
