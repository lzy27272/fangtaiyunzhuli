package cn.sifangguan.hotelaios.shared.security;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TenantIsolationMigrationTest {
    @Test
    void everyCriticalSurfaceIsCoveredByForcedRls() throws IOException {
        try (var input = getClass().getResourceAsStream("/db/migration/V2__tenant_row_level_security.sql")) {
            assertNotNull(input, "RLS迁移必须打包进入应用");
            String sql = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            assertTrue(sql.contains("FORCE ROW LEVEL SECURITY"));
            for (String table : new String[]{
                    "org_unit", "employee", "employee_position_assignment", "standard_version",
                    "work_record", "metric_observation", "audit_log", "outbox_event"
            }) {
                assertTrue(sql.contains("'" + table + "'"), table + " 必须纳入租户RLS列表");
            }
            assertTrue(sql.contains("current_setting(''app.tenant_id'', true)"));
        }
    }
}

