package cn.sifangguan.hotelaios.integrations.wecom;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class WeComGroupRobotWebhookIntegrationTest {
    private static final String TENANT = "10000000-0000-0000-0000-000000000001";
    private static final String CEO = "19000000-0000-0000-0000-000000000001";
    private static final String FRONT_DESK = "19000000-0000-0000-0000-000000000003";
    private static final String HOTEL = "12000000-0000-0000-0000-000000000003";
    private static final String WEBHOOK = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=test-store-secret";

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
        registry.add("app.wecom.group-robot.encryption-key", () -> "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=");
    }

    @AfterAll
    static void stopPostgres() throws Exception {
        POSTGRES.close();
    }

    @Test
    void configurationIsScopedEncryptedAndNeverReturned() throws Exception {
        MvcResult save = putJson("/api/v1/integrations/wecom/group-webhooks/" + HOTEL, CEO,
                "{\"webhookUrl\":\"" + WEBHOOK + "\"}", 200);
        String saveBody = save.getResponse().getContentAsString();
        assertThat(saveBody).doesNotContain(WEBHOOK).doesNotContain("test-store-secret");

        String persisted = jdbc.queryForObject("""
                select encode(webhook_ciphertext, 'base64')
                from wecom_group_robot_webhook
                where tenant_id = ? and hotel_org_unit_id = ?
                """, String.class, UUID.fromString(TENANT), UUID.fromString(HOTEL));
        assertThat(persisted).isNotBlank().doesNotContain("test-store-secret").isNotEqualTo(WEBHOOK);

        JsonNode allStores = json(getJson("/api/v1/integrations/wecom/group-webhooks", CEO, 200));
        JsonNode configuredStore = null;
        for (JsonNode row : allStores) {
            if (HOTEL.equals(row.path("hotelOrgUnitId").asText())) {
                configuredStore = row;
                break;
            }
        }
        assertThat(configuredStore).isNotNull();
        assertThat(configuredStore.path("configured").asBoolean()).isTrue();
        assertThat(configuredStore.toString()).doesNotContain(WEBHOOK).doesNotContain("test-store-secret");

        putJson("/api/v1/integrations/wecom/group-webhooks/" + HOTEL, FRONT_DESK,
                "{\"webhookUrl\":\"" + WEBHOOK + "\"}", 403);
        putJson("/api/v1/integrations/wecom/group-webhooks/" + HOTEL, CEO,
                "{\"webhookUrl\":\"https://example.com/cgi-bin/webhook/send?key=wrong-host\"}", 400);
    }

    private MvcResult getJson(String path, String actorId, int expectedStatus) throws Exception {
        return mockMvc.perform(get(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId))
                .andExpect(status().is(expectedStatus))
                .andReturn();
    }

    private MvcResult putJson(String path, String actorId, String body, int expectedStatus) throws Exception {
        return mockMvc.perform(put(path)
                        .header("X-Tenant-Id", TENANT)
                        .header("X-Actor-Id", actorId)
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().is(expectedStatus))
                .andReturn();
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
}
