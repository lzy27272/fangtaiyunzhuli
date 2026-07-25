package cn.sifangguan.ota.api.sprint1.application;

public final class RowVersionConflictException extends RuntimeException {
    public RowVersionConflictException() {
        super("Expected row version does not match current state");
    }
}
