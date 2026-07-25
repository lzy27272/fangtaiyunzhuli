package cn.sifangguan.ota.api.auth.application;

public class AuthenticationRejectedException extends RuntimeException {
    public AuthenticationRejectedException() {
        super("Authentication was rejected");
    }
}
