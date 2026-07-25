package cn.sifangguan.ota.api.authorization;

public enum OtaPermission {
    CROSS_TENANT_READ("ota.monitor.cross-tenant.read"),
    TENANT_CONFIG_MANAGE("ota.tenant-config.manage"),
    HOTEL_CONFIG_MANAGE("ota.hotel-config.manage"),
    CONNECTOR_CONFIG_MANAGE("ota.connector-config.manage"),
    CONNECTOR_AUTHORIZATION_MANAGE("ota.connector-authorization.manage"),
    ROOM_MAPPING_MANAGE("ota.room-mapping.manage"),
    REVENUE_TARGET_MANAGE("ota.revenue-target.manage"),
    PACE_CURVE_MANAGE("ota.pace-curve.manage"),
    SIMULATION_RUN_TRIGGER("ota.simulation-run.trigger");

    private final String code;

    OtaPermission(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
