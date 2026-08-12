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
    HOTEL_READ("ota.hotel.read"),
    PRICE_PREVIEW("ota.price.preview"),
    PRICE_REQUEST_CREATE("ota.price-request.create"),
    PRICE_APPROVE_AND_SYNC("ota.price.approve-and-sync"),
    SECRET_REFERENCE_MANAGE("ota.secret-reference.manage"),
    ALERT_POLICY_MANAGE("ota.alert-policy.manage"),
    AI_POLICY_MANAGE("ota.ai-policy.manage"),
    SIMULATION_RUN_TRIGGER("ota.simulation-run.trigger");

    private final String code;

    OtaPermission(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
