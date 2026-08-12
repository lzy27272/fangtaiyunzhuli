package cn.sifangguan.ota.api.auth.domain;

public enum OtaRole {
    PLATFORM_ADMIN,
    OTA_OPERATION_ASSISTANT,
    OTA_OPERATION_MANAGER,
    CEO,
    REGIONAL_MANAGER,
    GENERAL_MANAGER,
    ASSISTANT_GENERAL_MANAGER,
    FRONT_OFFICE_SUPERVISOR,
    @Deprecated(since = "0.2", forRemoval = false)
    REVENUE_MANAGER,
    HOTEL_P1_HANDLER;

    public boolean hasGlobalReadAccess() {
        return switch (this) {
            case PLATFORM_ADMIN, OTA_OPERATION_ASSISTANT, OTA_OPERATION_MANAGER, CEO, REGIONAL_MANAGER -> true;
            case GENERAL_MANAGER, ASSISTANT_GENERAL_MANAGER, FRONT_OFFICE_SUPERVISOR,
                    REVENUE_MANAGER, HOTEL_P1_HANDLER -> false;
        };
    }

    public boolean mayInitiatePriceRequest() {
        return switch (this) {
            case OTA_OPERATION_ASSISTANT, OTA_OPERATION_MANAGER, GENERAL_MANAGER,
                    ASSISTANT_GENERAL_MANAGER, FRONT_OFFICE_SUPERVISOR -> true;
            default -> false;
        };
    }

    public boolean isUnsupportedLegacyRole() {
        return this == REVENUE_MANAGER;
    }
}
