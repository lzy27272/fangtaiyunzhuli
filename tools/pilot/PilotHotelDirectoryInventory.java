import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

/** Read-only hotel master-data inventory. Credentials and connection details are never printed. */
public final class PilotHotelDirectoryInventory {
    private PilotHotelDirectoryInventory() { }

    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Usage: <jdbc-url>");
        try (Connection connection = DriverManager.getConnection(
                args[0], required("PILOT_DB_OWNER"), required("PILOT_DB_OWNER_PASSWORD"))) {
            connection.setReadOnly(true);
            List<String> hotels = new ArrayList<>();
            try (Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("""
                    select hotel.id::text as hotel_id,
                           tenant.code as tenant_code,
                           hotel.property_code,
                           org.code as org_code,
                           org.name as hotel_name,
                           hotel.room_count,
                           hotel.city
                    from hotel_profile hotel
                    join tenant on tenant.id = hotel.tenant_id
                    join org_unit org
                      on org.tenant_id = hotel.tenant_id
                     and org.id = hotel.org_unit_id
                    order by tenant.code, org.sort_order, hotel.property_code, hotel.id
                    """)) {
                while (rows.next()) {
                    hotels.add("{" +
                            json("hotelId", rows.getString("hotel_id")) + "," +
                            json("tenantCode", rows.getString("tenant_code")) + "," +
                            json("propertyCode", rows.getString("property_code")) + "," +
                            json("orgCode", rows.getString("org_code")) + "," +
                            json("hotelName", rows.getString("hotel_name")) + "," +
                            number("roomCount", rows.getObject("room_count")) + "," +
                            json("city", rows.getString("city")) +
                            "}");
                }
            }
            List<String> sourceTables = new ArrayList<>();
            try (Statement statement = connection.createStatement();
                 ResultSet rows = statement.executeQuery("""
                    select tablename
                    from pg_tables
                    where schemaname = 'public'
                      and (tablename like '%pms%'
                        or tablename like '%ota%'
                        or tablename like '%source%')
                    order by tablename
                    """)) {
                while (rows.next()) sourceTables.add(quote(rows.getString(1)));
            }
            System.out.println("{\"hotelCount\":" + hotels.size()
                    + ",\"hotels\":[" + String.join(",", hotels) + "]"
                    + ",\"sourceTables\":[" + String.join(",", sourceTables) + "]}");
        }
    }

    private static String json(String key, String value) {
        return quote(key) + ":" + (value == null ? "null" : quote(value));
    }

    private static String number(String key, Object value) {
        return quote(key) + ":" + (value == null ? "null" : value.toString());
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\r", "\\r")
                .replace("\n", "\\n") + "\"";
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) throw new IllegalStateException(name + " is required");
        return value;
    }
}
