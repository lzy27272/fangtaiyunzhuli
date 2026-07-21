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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import javax.imageio.ImageIO;
import javax.sql.DataSource;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class Sprint21BusinessIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String GM = "19000000-0000-0000-0000-000000000002";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String HOUSEKEEPING = "19000000-0000-0000-0000-000000000004";
    private static final String FRONT_SUPERVISOR = "19000000-0000-0000-0000-000000000005";
    private static final String REGIONAL_OPERATIONS = "19000000-0000-0000-0000-000000000007";
    private static final String HANGZHOU_HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String FRONT_DEPARTMENT = "12000000-0000-0000-0000-000000000005";
    private static final String FRONT_EMPLOYEE = "19100000-0000-0000-0000-000000000002";
    private static final String FRONT_ASSIGNMENT = "19200000-0000-0000-0000-000000000002";
    private static final String HOUSEKEEPING_ASSIGNMENT = "19200000-0000-0000-0000-000000000003";
    private static final String GM_ASSIGNMENT = "19200000-0000-0000-0000-000000000001";
    private static final String STANDARD_VERSION = "17000000-0000-0000-0000-000000000001";
    private static final String HOUSEKEEPING_RECORD = "19800000-0000-0000-0000-000000000002";

    private static final EmbeddedPostgres POSTGRES = startPostgres();
    private static final DataSource DATA_SOURCE = POSTGRES.getPostgresDatabase();
    private static final String JDBC_URL = jdbcUrl(DATA_SOURCE);
    private static final Path ATTACHMENT_ROOT = createAttachmentRoot();

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private ObjectMapper objectMapper;
    @Autowired
    private JdbcTemplate jdbc;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> JDBC_URL);
        registry.add("spring.datasource.username", () -> "postgres");
        registry.add("spring.datasource.password", () -> "postgres");
        registry.add("spring.flyway.user", () -> "postgres");
        registry.add("spring.flyway.password", () -> "postgres");
        registry.add("app.security.development-header-auth-enabled", () -> true);
        registry.add("app.database.rls-enabled", () -> true);
        registry.add("app.attachments.root", ATTACHMENT_ROOT::toString);
    }

    @AfterAll
    static void closePostgres() throws Exception {
        POSTGRES.close();
    }

    @Test
    void uploadsListsDownloadsAndDeletesRealImageWithScopeChecks() throws Exception {
        byte[] png = Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");
        MockMultipartFile file = new MockMultipartFile("file", "room-803.png", "image/png", png);
        MvcResult uploaded = mockMvc.perform(multipart("/api/v1/work-data/records/{recordId}/attachments/upload", HOUSEKEEPING_RECORD)
                        .file(file)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", HOUSEKEEPING))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.scanStatus").value("BYPASSED_DEV"))
                .andExpect(jsonPath("$.mediaType").value("image/png"))
                .andReturn();
        String attachmentId = json(uploaded).path("id").asText();

        mockMvc.perform(get("/api/v1/work-data/records/{recordId}/attachments", HOUSEKEEPING_RECORD)
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", HOUSEKEEPING))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(attachmentId))
                .andExpect(jsonPath("$[0].scan_status").value("BYPASSED_DEV"));

        byte[] downloaded = mockMvc.perform(get("/api/v1/work-data/attachments/{attachmentId}/content", attachmentId)
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", HOUSEKEEPING))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsByteArray();
        var sanitizedImage = ImageIO.read(new ByteArrayInputStream(downloaded));
        assertThat(sanitizedImage).isNotNull();
        assertThat(sanitizedImage.getWidth()).isEqualTo(1);
        assertThat(sanitizedImage.getHeight()).isEqualTo(1);

        mockMvc.perform(get("/api/v1/work-data/attachments/{attachmentId}/content", attachmentId)
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", FRONT_SUPERVISOR))
                .andExpect(status().isForbidden());

        mockMvc.perform(delete("/api/v1/work-data/records/{recordId}/attachments/{attachmentId}",
                        HOUSEKEEPING_RECORD, attachmentId)
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", HOUSEKEEPING))
                .andExpect(status().isNoContent());
        assertThat(jdbc.queryForObject("select count(*) from attachment where id = ?::uuid", Integer.class, attachmentId))
                .isZero();
    }

    @Test
    void complaintSubmissionEmitsDedicatedEventWithBusinessFacts() throws Exception {
        UUID formId = UUID.randomUUID();
        UUID versionId = UUID.randomUUID();
        jdbc.update("""
                insert into form_definition (id, tenant_id, code, name, form_type, position_id)
                values (?, ?::uuid, 'COMPLAINT-EVENT', '客诉事件登记', 'COMPLAINT',
                        '14000000-0000-0000-0000-000000000001'::uuid)
                """, formId, TENANT);
        jdbc.update("""
                insert into form_version
                    (id, tenant_id, form_id, version_no, lifecycle_status, json_schema, ui_schema, published_at)
                values (?, ?::uuid, ?, 1, 'PUBLISHED',
                        '{"type":"object","required":["severity","guestRequest"],"properties":{"severity":{"type":"string"},"guestRequest":{"type":"string"}}}'::jsonb,
                        '{}'::jsonb, now())
                """, versionId, TENANT, formId);

        MvcResult submitted = postJson("/api/v1/work-data/records", FRONT_DESK, null, """
                {
                  "orgUnitId":"%s",
                  "employeeId":"%s",
                  "positionAssignmentId":"%s",
                  "formVersionId":"%s",
                  "businessDate":"%s",
                  "recordKind":"EVENT",
                  "targetOrgUnitId":"%s",
                  "payload":{"severity":"MAJOR","guestRequest":"房间噪音投诉"}
                }
                """.formatted(FRONT_DEPARTMENT, FRONT_EMPLOYEE, FRONT_ASSIGNMENT, versionId,
                java.time.LocalDate.now(), FRONT_DEPARTMENT));
        String recordId = json(submitted).path("id").asText();
        String payload = jdbc.queryForObject("""
                select payload::text from outbox_event
                where aggregate_id = ?::uuid and event_type = 'COMPLAINTREPORTED'
                order by occurred_at desc limit 1
                """, String.class, recordId);
        JsonNode facts = objectMapper.readTree(payload);
        assertThat(facts.path("formCode").asText()).isEqualTo("COMPLAINT-EVENT");
        assertThat(facts.path("recordKind").asText()).isEqualTo("EVENT");
        assertThat(facts.path("businessPayload").path("severity").asText()).isEqualTo("MAJOR");
        assertThat(facts.path("positionAssignmentId").asText()).isEqualTo(FRONT_ASSIGNMENT);
    }

    @Test
    void hotelAndOperationsDashboardsExposeOpenTasksAndRiskItems() throws Exception {
        MvcResult task = postJson("/api/v1/tasks", CEO, "s21-dashboard-task-" + UUID.randomUUID(), """
                {
                  "orgUnitId":"%s",
                  "assigneeAssignmentId":"%s",
                  "reviewerAssignmentId":"%s",
                  "standardVersionId":"%s",
                  "title":"客房卫生逾期整改",
                  "priority":"URGENT",
                  "dueAt":"%s"
                }
                """.formatted(HANGZHOU_HOTEL, HOUSEKEEPING_ASSIGNMENT, GM_ASSIGNMENT,
                STANDARD_VERSION, OffsetDateTime.now().minusHours(1)));
        String taskId = json(task).path("id").asText();
        postJson("/api/v1/tasks/sla/process", CEO, null, "{}");

        mockMvc.perform(get("/api/v1/dashboards/hotels/{hotelId}", HANGZHOU_HOTEL)
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", GM))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.openTaskCount").value(1))
                .andExpect(jsonPath("$.overdueTaskCount").value(1))
                .andExpect(jsonPath("$.risks[0].risk_type").value("OVERDUE_TASK"))
                .andExpect(jsonPath("$.incompleteTasks[0].id").value(taskId));

        mockMvc.perform(get("/api/v1/dashboards/operations")
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", CEO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hotelCount").value(2))
                .andExpect(jsonPath("$.hotels").isArray());

        UUID outsideRegion = UUID.randomUUID();
        UUID outsideHotel = UUID.randomUUID();
        jdbc.update("""
                insert into org_unit (id, tenant_id, parent_id, code, name, unit_type, sort_order)
                values (?, ?::uuid, '12000000-0000-0000-0000-000000000001'::uuid, ?, '华南区域', 'REGION', 9),
                       (?, ?::uuid, ?, ?, '广州隔离测试店', 'HOTEL', 1)
                """, outsideRegion, TENANT, "SOUTH-" + outsideRegion.toString().substring(0, 8),
                outsideHotel, TENANT, outsideRegion, "GZ-" + outsideHotel.toString().substring(0, 8));
        jdbc.update("""
                insert into org_unit_closure (tenant_id, ancestor_id, descendant_id, depth)
                values (?::uuid, ?, ?, 0),
                       (?::uuid, '12000000-0000-0000-0000-000000000001'::uuid, ?, 1),
                       (?::uuid, ?, ?, 0),
                       (?::uuid, ?, ?, 1),
                       (?::uuid, '12000000-0000-0000-0000-000000000001'::uuid, ?, 2)
                """, TENANT, outsideRegion, outsideRegion,
                TENANT, outsideRegion,
                TENANT, outsideHotel, outsideHotel,
                TENANT, outsideRegion, outsideHotel,
                TENANT, outsideHotel);
        jdbc.update("""
                insert into hotel_profile
                    (id, tenant_id, org_unit_id, brand_id, property_code, city, room_count)
                values (?, ?::uuid, ?, '11000000-0000-0000-0000-000000000001'::uuid, ?, '广州', 96)
                """, UUID.randomUUID(), TENANT, outsideHotel, "GZ" + outsideHotel.toString().substring(0, 6));

        mockMvc.perform(get("/api/v1/dashboards/operations")
                        .header("X-Tenant-Id", TENANT).header("X-Actor-Id", REGIONAL_OPERATIONS))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.hotelCount").value(2))
                .andExpect(jsonPath("$.hotels.length()").value(2));
    }

    @Test
    void overdueTaskReminderIsFollowedByAnExecutableEscalation() throws Exception {
        MvcResult task = postJson("/api/v1/tasks", CEO, "s21-escalation-task-" + UUID.randomUUID(), """
                {
                  "orgUnitId":"%s",
                  "assigneeAssignmentId":"%s",
                  "reviewerAssignmentId":"%s",
                  "standardVersionId":"%s",
                  "title":"未完成工作提醒升级验证",
                  "priority":"HIGH",
                  "dueAt":"%s"
                }
                """.formatted(HANGZHOU_HOTEL, FRONT_ASSIGNMENT, GM_ASSIGNMENT,
                STANDARD_VERSION, OffsetDateTime.now().minusHours(49)));
        String taskId = json(task).path("id").asText();

        MvcResult processed = postJson("/api/v1/tasks/sla/process", CEO, null, "{}");
        assertThat(json(processed).path("overdueTasks").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(json(processed).path("escalations").asInt()).isGreaterThanOrEqualTo(1);
        assertThat(jdbc.queryForObject("""
                select status from task_escalation
                where tenant_id = ?::uuid and task_id = ?::uuid and escalation_level = 1
                """, String.class, TENANT, taskId)).isEqualTo("EXECUTED");
        assertThat(jdbc.queryForObject("""
                select count(*) from task_transition
                where tenant_id = ?::uuid and task_id = ?::uuid and command = 'ESCALATE'
                """, Integer.class, TENANT, taskId)).isEqualTo(1);
        assertThat(jdbc.queryForObject("""
                select count(*) from notification
                where tenant_id = ?::uuid and source_id = ?::uuid and notification_type = 'TASK_ESCALATED'
                """, Integer.class, TENANT, taskId)).isEqualTo(1);

        MvcResult repeated = postJson("/api/v1/tasks/sla/process", CEO, null, "{}");
        assertThat(json(repeated).path("escalations").asInt()).isZero();
        assertThat(jdbc.queryForObject("""
                select count(*) from task_transition
                where tenant_id = ?::uuid and task_id = ?::uuid and command = 'ESCALATE'
                """, Integer.class, TENANT, taskId)).isEqualTo(1);
    }

    private MvcResult postJson(String path, String actorId, String idempotencyKey, String body) throws Exception {
        var builder = post(path)
                .header("X-Tenant-Id", TENANT)
                .header("X-Actor-Id", actorId)
                .contentType("application/json")
                .content(body);
        if (idempotencyKey != null) {
            builder.header("Idempotency-Key", idempotencyKey);
        }
        return mockMvc.perform(builder).andExpect(status().is2xxSuccessful()).andReturn();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString());
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

    private static Path createAttachmentRoot() {
        try {
            return Files.createTempDirectory("hotel-ai-os-s21-attachments-");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
