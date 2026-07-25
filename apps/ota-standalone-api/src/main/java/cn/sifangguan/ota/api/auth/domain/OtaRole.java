package cn.sifangguan.ota.api.auth.domain;

public enum OtaRole {
    PLATFORM_ADMIN,
    OTA_OPERATION_ASSISTANT,
    OTA_OPERATION_MANAGER,
    CEO,
    REGIONAL_MANAGER,
    REVENUE_MANAGER,
    HOTEL_P1_HANDLER;

    public boolean hasGlobalReadAccess() {
        return switch (this) {
            case PLATFORM_ADMIN, OTA_OPERATION_ASSISTANT, OTA_OPERATION_MANAGER, CEO, REGIONAL_MANAGER -> true;
            case REVENUE_MANAGER, HOTEL_P1_HANDLER -> false;
        };
    }
}
