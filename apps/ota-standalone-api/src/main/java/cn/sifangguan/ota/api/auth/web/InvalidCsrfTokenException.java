package cn.sifangguan.ota.api.auth.web;

public final class InvalidCsrfTokenException extends RuntimeException {
    public InvalidCsrfTokenException() {
        super("CSRF validation failed");
    }
}
