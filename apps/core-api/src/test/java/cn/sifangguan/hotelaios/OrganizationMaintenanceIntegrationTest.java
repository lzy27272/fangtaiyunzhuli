package cn.sifangguan.hotelaios;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.zonky.test.db.postgres.embedded.EmbeddedPostgres;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.sql.DataSource;
import java.sql.Connection;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class OrganizationMaintenanceIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String FRONT_DESK_ROLE = "19400000-0000-0000-0000-000000000003";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;

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
    void unusedInactiveMasterDataCanBeDeletedAfterEditing() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        UUID orgId = UUID.fromString(json(postJson("/api/v1/org/units", CEO, """
                {"parentId":"%s","code":"TMP-ORG-%s","name":"临时测试部门","unitType":"DEPARTMENT","sortOrder":99}
                """.formatted(HOTEL, suffix))).path("id").asText());
        UUID positionId = UUID.fromString(json(postJson("/api/v1/org/positions", CEO, """
                {"code":"TMP-POS-%s","name":"临时测试岗位","jobFamily":"测试","levelCode":"T1"}
                """.formatted(suffix))).path("id").asText());
        UUID employeeId = UUID.fromString(json(postJson("/api/v1/org/employees", CEO, """
                {"employeeNo":"TMP-EMP-%s","name":"临时测试员工","mobile":"13900000000","hiredOn":"2026-07-19"}
                """.formatted(suffix))).path("id").asText());

        putJson("/api/v1/org/units/" + orgId, CEO, """
                {"code":"TMP-ORG-%s","name":"临时测试部门已修改","sortOrder":98,"status":"INACTIVE"}
                """.formatted(suffix), 200);
        putJson("/api/v1/org/positions/" + positionId, CEO, """
                {"code":"TMP-POS-%s","name":"临时测试岗位已修改","jobFamily":"测试","levelCode":"T2","status":"INACTIVE"}
                """.formatted(suffix), 200);
        putJson("/api/v1/org/employees/" + employeeId, CEO, """
                {"employeeNo":"TMP-EMP-%s","name":"临时测试员工已修改","mobile":"13900000001","hiredOn":"2026-07-19","employmentStatus":"INACTIVE"}
                """.formatted(suffix), 200);

        deleteJson("/api/v1/org/units/" + orgId, CEO, 204);
        deleteJson("/api/v1/org/positions/" + positionId, CEO, 204);
        deleteJson("/api/v1/org/employees/" + employeeId, CEO, 204);

        assertThat(count("org_unit", orgId)).isZero();
        assertThat(count("position_definition", positionId)).isZero();
        assertThat(count("employee", employeeId)).isZero();
    }

    @Test
    void deactivationPreservesHistoryAndDisablesAccessPaths() throws Exception {
        String suffix = UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        UUID orgId = UUID.fromString(json(postJson("/api/v1/org/units", CEO, """
                {"parentId":"%s","code":"HIS-ORG-%s","name":"历史测试部门","unitType":"DEPARTMENT","sortOrder":99}
                """.formatted(HOTEL, suffix))).path("id").asText());
        UUID positionId = UUID.fromString(json(postJson("/api/v1/org/positions", CEO, """
                {"code":"HIS-POS-%s","name":"历史测试岗位","jobFamily":"测试","levelCode":"H1"}
                """.formatted(suffix))).path("id").asText());
        JsonNode employee = json(postJson("/api/v1/org/employees", CEO, """
                {"employeeNo":"HIS-EMP-%s","name":"历史测试员工","mobile":"13900000002","hiredOn":"2026-07-19","loginName":"history.%s","temporaryPassword":"TempPass!2026"}
                """.formatted(suffix, suffix.toLowerCase())));
        UUID employeeId = UUID.fromString(employee.path("id").asText());
        UUID accountId = UUID.fromString(employee.path("accountId").asText());
        UUID assignmentId = UUID.fromString(json(postJson("/api/v1/org/employees/" + employeeId + "/assignments", CEO, """
                {"orgUnitId":"%s","positionId":"%s","primary":true,"assignmentType":"PERMANENT","validFrom":"2026-07-19"}
                """.formatted(orgId, positionId))).path("id").asText());
        postJson("/api/v1/iam/role-assignments", CEO, """
                {"accountId":"%s","roleId":"%s","scopeOrgUnitId":"%s","scopeType":"ORG_TREE"}
                """.formatted(accountId, FRONT_DESK_ROLE, orgId));

        putJson("/api/v1/org/units/" + orgId, CEO, """
                {"code":"HIS-ORG-%s","name":"历史测试部门","sortOrder":99,"status":"INACTIVE"}
                """.formatted(suffix), 200);

        assertThat(jdbc.queryForObject("select status from employee_position_assignment where id = ?", String.class, assignmentId))
                .isEqualTo("INACTIVE");
        assertThat(jdbc.queryForObject("select valid_to is not null from role_assignment where account_id = ? and scope_org_unit_id = ?", Boolean.class, accountId, orgId))
                .isTrue();
        deleteJson("/api/v1/org/units/" + orgId, CEO, 400);

        putJson("/api/v1/org/positions/" + positionId, CEO, """
                {"code":"HIS-POS-%s","name":"历史测试岗位","jobFamily":"测试","levelCode":"H1","status":"INACTIVE"}
                """.formatted(suffix), 200);
        deleteJson("/api/v1/org/positions/" + positionId, CEO, 400);

        putJson("/api/v1/org/employees/" + employeeId, CEO, """
                {"employeeNo":"HIS-EMP-%s","name":"历史测试员工","mobile":"13900000002","hiredOn":"2026-07-19","employmentStatus":"INACTIVE","loginName":"history.%s"}
                """.formatted(suffix, suffix.toLowerCase()), 200);
        assertThat(jdbc.queryForObject("select status from user_account where id = ?", String.class, accountId))
                .isEqualTo("INACTIVE");
        deleteJson("/api/v1/org/employees/" + employeeId, CEO, 400);
    }

    @Test
    void staffWithoutOrganizationManagementPermissionCannotModifyMasterData() throws Exception {
        putJson("/api/v1/org/units/" + HOTEL, FRONT_DESK, """
                {"code":"HZ-CENTER","name":"不应修改","sortOrder":1,"status":"ACTIVE","propertyCode":"HZ001"}
                """, 403);
    }

    private MvcResult postJson(String path, String actorId, String body) throws Exception {
        return mockMvc.perform(post(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().is2xxSuccessful())
                .andReturn();
    }

    private void putJson(String path, String actorId, String body, int expectedStatus) throws Exception {
        mockMvc.perform(put(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().is(expectedStatus));
    }

    private void deleteJson(String path, String actorId, int expectedStatus) throws Exception {
        mockMvc.perform(delete(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId))
                .andExpect(status().is(expectedStatus));
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }

    private int count(String table, UUID id) {
        return jdbc.queryForObject("select count(*) from " + table + " where id = ?", Integer.class, id);
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
