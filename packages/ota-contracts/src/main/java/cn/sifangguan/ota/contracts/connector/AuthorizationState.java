package cn.sifangguan.ota.contracts.connector;

public enum AuthorizationState {
    AUTHORIZED,
    AUTH_REQUIRED,
    PENDING_INTERACTION,
    REVOKED,
    UNKNOWN
}
