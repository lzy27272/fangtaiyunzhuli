package cn.sifangguan.ota.api.gateway;

import cn.sifangguan.ota.api.authorization.OtaPermission;

public enum GatewayAction {
    HOTEL_READ(OtaPermission.HOTEL_READ, "HOTEL_READ"),
    PRICE_PREVIEW(OtaPermission.PRICE_PREVIEW, "PRICE_PREVIEW"),
    PRICE_REQUEST_CREATE(OtaPermission.PRICE_REQUEST_CREATE, "PRICE_REQUEST_CREATE"),
    PRICE_APPROVE_AND_SYNC(OtaPermission.PRICE_APPROVE_AND_SYNC, "PRICE_APPROVE_AND_SYNC"),
    SECRET_REFERENCE_MANAGE(OtaPermission.SECRET_REFERENCE_MANAGE, "SECRET_REFERENCE_MANAGE"),
    ALERT_POLICY_MANAGE(OtaPermission.ALERT_POLICY_MANAGE, "ALERT_POLICY_MANAGE"),
    AI_POLICY_MANAGE(OtaPermission.AI_POLICY_MANAGE, "AI_POLICY_MANAGE");

    private final OtaPermission permission;
    private final String hotelScopeType;

    GatewayAction(OtaPermission permission, String hotelScopeType) {
        this.permission = permission;
        this.hotelScopeType = hotelScopeType;
    }

    public OtaPermission permission() {
        return permission;
    }

    public String hotelScopeType() {
        return hotelScopeType;
    }
}
