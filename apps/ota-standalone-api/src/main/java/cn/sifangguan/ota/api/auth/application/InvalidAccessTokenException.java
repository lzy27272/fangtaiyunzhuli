package cn.sifangguan.ota.api.auth.application;

public final class InvalidAccessTokenException extends RuntimeException {
    public InvalidAccessTokenException() {
        super("Access token is invalid");
    }
}
