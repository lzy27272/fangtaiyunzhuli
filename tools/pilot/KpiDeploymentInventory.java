import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;

/** Read-only KPI deployment inventory. No credentials or row-level business data are printed. */
public final class KpiDeploymentInventory {
    private KpiDeploymentInventory() {
    }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) {
            throw new IllegalArgumentException("Usage: KpiDeploymentInventory <jdbc-url>");
        }
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"));
             Statement statement = connection.createStatement()) {
            connection.setReadOnly(true);
            try (ResultSet result = statement.executeQuery("""
                    select
                      (select max(version::int) from flyway_schema_history
                       where success and version ~ '^[0-9]+$') as flyway_version,
                      (select count(*) from kpi_template_definition
                       where code = 'KPI-OTA-OPERATION-MANAGER') as ota_template_count,
                      (select count(*)
                       from kpi_template_version template_version
                       join standard_version standard
                         on standard.tenant_id = template_version.tenant_id
                        and standard.id = template_version.standard_version_id
                       where standard.lifecycle_status = 'PUBLISHED') as published_template_versions,
                      (select count(*) from kpi_inspection_schedule where active) as active_inspection_slots,
                      (select count(*) from permission where code like 'kpi.%') as kpi_permissions,
                      (select count(*) from pg_tables
                       where schemaname = 'public' and tablename like 'kpi_%') as kpi_tables
                    """)) {
                if (!result.next()) throw new IllegalStateException("KPI inventory returned no row");
                System.out.printf(
                        "KPI_DEPLOYMENT_INVENTORY flyway=%d otaTemplates=%d publishedKpiVersions=%d activeInspectionSlots=%d kpiPermissions=%d kpiTables=%d%n",
                        result.getInt("flyway_version"),
                        result.getInt("ota_template_count"),
                        result.getInt("published_template_versions"),
                        result.getInt("active_inspection_slots"),
                        result.getInt("kpi_permissions"),
                        result.getInt("kpi_tables"));
            }
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException("Missing environment variable: " + name);
        return value;
    }
}
