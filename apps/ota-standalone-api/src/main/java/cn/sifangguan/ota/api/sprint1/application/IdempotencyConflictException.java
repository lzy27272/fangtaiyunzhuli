package cn.sifangguan.ota.api.sprint1.application;

public final class IdempotencyConflictException extends RuntimeException {
    public IdempotencyConflictException() {
        super("Idempotency key was already used for a different request");
    }
}
