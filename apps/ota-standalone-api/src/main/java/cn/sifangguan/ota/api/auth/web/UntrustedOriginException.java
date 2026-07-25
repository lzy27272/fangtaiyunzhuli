package cn.sifangguan.ota.api.auth.web;

public final class UntrustedOriginException extends RuntimeException {
    public UntrustedOriginException() {
        super("Origin is not trusted");
    }
}
