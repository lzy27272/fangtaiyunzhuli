package cn.sifangguan.ota.browsersession;

public enum BrowserSessionState {
    PENDING_INTERACTIVE_LOGIN,
    ACTIVE,
    EXPIRING,
    REAUTH_REQUIRED,
    REVOKED
}
