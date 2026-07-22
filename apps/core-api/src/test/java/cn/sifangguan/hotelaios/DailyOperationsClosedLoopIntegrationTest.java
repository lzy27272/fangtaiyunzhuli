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
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class DailyOperationsClosedLoopIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String GENERAL_MANAGER = "19000000-0000-0000-0000-000000000002";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String FRONT_SUPERVISOR = "19000000-0000-0000-0000-000000000005";
    private static final String FRONT_DEPARTMENT = "12000000-0000-0000-0000-000000000005";
    private static final String SHANGHAI_HOTEL = "12000000-0000-0000-0000-000000000004";
    private static final String FRONT_DESK_ASSIGNMENT = "19200000-0000-0000-0000-000000000002";
    private static final String FRONT_SUPERVISOR_ASSIGNMENT = "19200000-0000-0000-0000-000000000004";
    private static final String GENERAL_MANAGER_ASSIGNMENT = "19200000-0000-0000-0000-000000000001";
    private static final String SOURCE_WORK_RECORD = "19800000-0000-0000-0000-000000000001";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void rejectsCrossHotelAssigneeBeforeCreatingCandidateOrFormalTask() throws Exception {
        String businessDate = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
        String crossHotelAssignment = UUID.randomUUID().toString();
        String idempotencyKey = "cross-hotel-candidate-" + UUID.randomUUID();
        int candidatesBefore = count("select count(*) from task_candidate where tenant_id = ?::uuid", TENANT);
        int tasksBefore = count("select count(*) from management_task where tenant_id = ?::uuid", TENANT);

        jdbc.update("""
                insert into employee_position_assignment
                    (id, tenant_id, employee_id, org_unit_id, position_id,
                     is_primary, assignment_type, valid_from, status)
                values (?::uuid, ?::uuid, '19100000-0000-0000-0000-000000000002'::uuid,
                        ?::uuid, '14000000-0000-0000-0000-000000000001'::uuid,
                        false, 'TEMPORARY', ?::date, 'ACTIVE')
                """, crossHotelAssignment, TENANT, SHANGHAI_HOTEL, businessDate);
        try {
            MvcResult rejected = postJson("/api/v1/task-candidates", FRONT_SUPERVISOR,
                    idempotencyKey, """
                            {
                              "orgUnitId":"%s",
                              "businessDate":"%s",
                              "assigneeAssignmentId":"%s",
                              "reviewerAssignmentId":"%s",
                              "title":"跨酒店责任任职不得生成候选任务",
                              "priority":"HIGH",
                              "createdByAssignmentId":"%s"
                            }
                            """.formatted(FRONT_DEPARTMENT, businessDate, crossHotelAssignment,
                            GENERAL_MANAGER_ASSIGNMENT, FRONT_SUPERVISOR_ASSIGNMENT), 400);

            assertThat(json(rejected).path("detail").asText()).contains("候选组织");
            assertThat(count("select count(*) from task_candidate where tenant_id = ?::uuid", TENANT))
                    .isEqualTo(candidatesBefore);
            assertThat(count("select count(*) from management_task where tenant_id = ?::uuid", TENANT))
                    .isEqualTo(tasksBefore);
            assertThat(count("""
                    select count(*) from task_candidate
                    where tenant_id = ?::uuid and idempotency_key = ?
                    """, TENANT, idempotencyKey)).isZero();
            assertThat(count("""
                    select count(*) from command_idempotency_record
                    where tenant_id = ?::uuid
                      and command_scope = 'TASK_CANDIDATE_CREATE'
                      and idempotency_key = ?
                    """, TENANT, idempotencyKey)).isZero();
        } finally {
            jdbc.update("""
                    delete from employee_position_assignment
                    where tenant_id = ?::uuid and id = ?::uuid
                    """, TENANT, crossHotelAssignment);
        }
    }

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> true);
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.work-expectation.sla.scheduler-enabled", () -> false);
    }

    @Test
    void requiresHumanConfirmationThenReusesTaskCenterForExecutionAndClosure() throws Exception {
        String businessDate = LocalDate.now(ZoneId.of("Asia/Shanghai")).toString();
        String issueKey = "daily-operation-issue-" + UUID.randomUUID();
        String issueBody = """
                {
                  "orgUnitId":"%s",
                  "businessDate":"%s",
                  "title":"前厅交接发现待整改事项",
                  "description":"现场记录进入主管确认闭环",
                  "severity":"IMPORTANT",
                  "ownerAssignmentId":"%s",
                  "verifierAssignmentId":"%s",
                  "createdByAssignmentId":"%s",
                  "sourceType":"WORK_RECORD",
                  "sourceId":"%s",
                  "sourceSnapshot":{"evidence":"交接记录"}
                }
                """.formatted(FRONT_DEPARTMENT, businessDate, FRONT_DESK_ASSIGNMENT,
                GENERAL_MANAGER_ASSIGNMENT, FRONT_SUPERVISOR_ASSIGNMENT, SOURCE_WORK_RECORD);

        MvcResult createdIssue = postJson(
                "/api/v1/daily-operations/issues", FRONT_SUPERVISOR, issueKey, issueBody, 201);
        String issueId = json(createdIssue).path("id").asText();
        assertThat(json(createdIssue).path("lifecycle_status").asText()).isEqualTo("CANDIDATE");

        MvcResult replayedIssue = postJson(
                "/api/v1/daily-operations/issues", FRONT_SUPERVISOR, issueKey, issueBody, 201);
        assertThat(json(replayedIssue).path("id").asText()).isEqualTo(issueId);

        postJson("/api/v1/daily-operations/issues/" + issueId + "/actions/confirm",
                FRONT_SUPERVISOR, "issue-confirm-" + UUID.randomUUID(), """
                        {"expectedVersion":0,"actorAssignmentId":"%s"}
                        """.formatted(FRONT_SUPERVISOR_ASSIGNMENT), 200);

        MvcResult candidate = postJson("/api/v1/task-candidates", FRONT_SUPERVISOR,
                "candidate-create-" + UUID.randomUUID(), """
                        {
                          "issueId":"%s",
                          "title":"完成前厅交接整改",
                          "description":"根据问题来源完成整改并提交结果",
                          "priority":"HIGH",
                          "dueAt":"2026-07-23T12:00:00Z",
                          "acceptanceCriteria":"现场复核通过并留存结果说明",
                          "createdByAssignmentId":"%s",
                          "sourceSnapshot":{"origin":"SUPERVISOR_CONFIRMED_ISSUE"}
                        }
                        """.formatted(issueId, FRONT_SUPERVISOR_ASSIGNMENT), 201);
        String candidateId = json(candidate).path("id").asText();
        assertThat(json(candidate).path("status").asText()).isEqualTo("PENDING_CONFIRMATION");
        assertThat(count("""
                select count(*) from management_task
                where tenant_id = ?::uuid and source_snapshot ->> 'taskCandidateId' = ?
                """, TENANT, candidateId)).isZero();

        postJson("/api/v1/task-candidates/" + candidateId + "/confirm", GENERAL_MANAGER,
                "candidate-confirm-" + UUID.randomUUID(), """
                        {"expectedVersion":0,"actorAssignmentId":"%s","reason":"同意生成整改任务"}
                        """.formatted(GENERAL_MANAGER_ASSIGNMENT), 202);

        String taskId = jdbc.queryForObject("""
                select formal_task_id::text from task_candidate
                where tenant_id = ?::uuid and id = ?::uuid and status = 'TASK_CREATED'
                """, String.class, TENANT, candidateId);
        assertThat(taskId).isNotBlank();
        assertThat(jdbc.queryForObject("""
                select source_snapshot ->> 'acceptanceCriteria' from management_task
                where tenant_id = ?::uuid and id = ?::uuid
                """, String.class, TENANT, taskId)).isEqualTo("现场复核通过并留存结果说明");

        postJson("/api/v1/daily-operations/issues/" + issueId + "/actions/start",
                FRONT_SUPERVISOR, "issue-start-" + UUID.randomUUID(), """
                        {"expectedVersion":1,"actorAssignmentId":"%s"}
                        """.formatted(FRONT_SUPERVISOR_ASSIGNMENT), 200);
        postJson("/api/v1/daily-operations/issues/" + issueId + "/actions/request-close",
                FRONT_SUPERVISOR, "issue-ready-" + UUID.randomUUID(), """
                        {"expectedVersion":2,"actorAssignmentId":"%s","reason":"整改已提交，申请验收"}
                        """.formatted(FRONT_SUPERVISOR_ASSIGNMENT), 200);

        postJson("/api/v1/daily-operations/issues/" + issueId + "/actions/close",
                GENERAL_MANAGER, "issue-premature-close-" + UUID.randomUUID(), """
                        {"expectedVersion":3,"actorAssignmentId":"%s","reason":"提前关闭探针"}
                        """.formatted(GENERAL_MANAGER_ASSIGNMENT), 409);

        taskCommand(taskId, "acknowledge", FRONT_DESK, FRONT_DESK_ASSIGNMENT, 1);
        taskCommand(taskId, "submit-result", FRONT_DESK, FRONT_DESK_ASSIGNMENT, 2);
        taskCommand(taskId, "approve", GENERAL_MANAGER, GENERAL_MANAGER_ASSIGNMENT, 3);

        postJson("/api/v1/daily-operations/issues/" + issueId + "/actions/close",
                GENERAL_MANAGER, "issue-close-" + UUID.randomUUID(), """
                        {"expectedVersion":3,"actorAssignmentId":"%s","reason":"任务验收完成，问题关闭"}
                        """.formatted(GENERAL_MANAGER_ASSIGNMENT), 200)
                .getResponse();

        assertThat(jdbc.queryForObject("""
                select lifecycle_status from issue_event
                where tenant_id = ?::uuid and id = ?::uuid
                """, String.class, TENANT, issueId)).isEqualTo("CLOSED");
        assertThat(count("""
                select count(*) from issue_task_link
                where tenant_id = ?::uuid and issue_id = ?::uuid and management_task_id = ?::uuid
                """, TENANT, issueId, taskId)).isEqualTo(1);
        assertThat(count("""
                select count(*) from outbox_event
                where tenant_id = ?::uuid and aggregate_id = ?::uuid
                  and event_type in ('TASK_CANDIDATE_CONFIRMED', 'SYNC_OPERATION_COMPLETED')
                """, TENANT, candidateId)).isEqualTo(2);
    }

    private void taskCommand(
            String taskId,
            String command,
            String actorId,
            String actorAssignmentId,
            long expectedVersion
    ) throws Exception {
        postJson("/api/v1/tasks/" + taskId + "/actions/" + command, actorId,
                "closed-loop-task-" + command + "-" + UUID.randomUUID(), """
                        {
                          "expectedVersion":%d,
                          "actorAssignmentId":"%s",
                          "payload":{"remark":"日运营闭环集成测试","result":{"summary":"done"}}
                        }
                        """.formatted(expectedVersion, actorAssignmentId), 200);
    }

    private MvcResult postJson(
            String path,
            String actorId,
            String idempotencyKey,
            String body,
            int expectedStatus
    ) throws Exception {
        return mockMvc.perform(post(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId)
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private int count(String sql, Object... args) {
        Integer result = jdbc.queryForObject(sql, Integer.class, args);
        return result == null ? 0 : result;
    }

    @AfterAll
    static void closePostgres() throws Exception {
        POSTGRES.close();
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
