package cn.sifangguan.hotelaios;

import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import javax.sql.DataSource;
import java.sql.Connection;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class ApiRuntimeIntegrationTest {

    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String OTHER_TENANT = "20000000-0000-0000-0000-000000000002";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String GENERAL_MANAGER = "19000000-0000-0000-0000-000000000002";
    private static final String HANGZHOU_HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String SHANGHAI_HOTEL = "12000000-0000-0000-0000-000000000004";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);

    @Autowired
    private MockMvc mockMvc;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> true);
        registry.add("app.database.rls-enabled", () -> true);
    }

    @AfterAll
    static void stopPostgres() throws Exception {
        POSTGRES.close();
    }

    @Test
    void ceoDashboardReturnsSeededGroupOverview() throws Exception {
        mockMvc.perform(get("/api/v1/dashboards/ceo")
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", CEO)
                        .header("X-Role-Code", "CEO"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hotelCount").value(2))
                .andExpect(jsonPath("$.employeeCount").value(7))
                .andExpect(jsonPath("$.publishedStandardCount").value(3))
                .andExpect(jsonPath("$.todayWorkSubmissionCount").value(3))
                .andExpect(jsonPath("$.latestMetrics.length()").value(5));
    }

    @Test
    void generalManagerCanReadOnlyAssignedHotelScope() throws Exception {
        mockMvc.perform(get("/api/v1/dashboards/hotels/{hotelId}", HANGZHOU_HOTEL)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", GENERAL_MANAGER)
                        .header("X-Role-Code", "GENERAL_MANAGER")
                        .header("X-Org-Scope", HANGZHOU_HOTEL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hotel.id").value(HANGZHOU_HOTEL))
                .andExpect(jsonPath("$.activeEmployeeCount").value(5))
                .andExpect(jsonPath("$.todayWorkSubmissionCount").value(3));

        mockMvc.perform(get("/api/v1/dashboards/hotels/{hotelId}", SHANGHAI_HOTEL)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", GENERAL_MANAGER)
                        .header("X-Role-Code", "GENERAL_MANAGER")
                        .header("X-Org-Scope", HANGZHOU_HOTEL))
                .andExpect(status().isForbidden());
    }

    @Test
    void requestContextFailsClosedAndUnknownTenantAccountIsRejected() throws Exception {
        mockMvc.perform(get("/api/v1/dashboards/ceo"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get("/api/v1/dashboards/ceo")
                        .header("X-Tenant-Id", OTHER_TENANT)
                        .header("X-Actor-Id", "29000000-0000-0000-0000-000000000001")
                        .header("X-Role-Code", "CEO"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void effectiveIdentityIgnoresSpoofedClientRoleAndScopeHeaders() throws Exception {
        mockMvc.perform(get("/api/v1/iam/me")
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", GENERAL_MANAGER)
                        .header("X-Role-Code", "CEO")
                        .header("X-Org-Scope", SHANGHAI_HOTEL))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.primaryRole").value("GENERAL_MANAGER"))
                .andExpect(jsonPath("$.tenantScope").value(false))
                .andExpect(jsonPath("$.organizationScopes.length()").value(3))
                .andExpect(jsonPath("$.positionAssignments[0].id").value("19200000-0000-0000-0000-000000000001"));
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
}
