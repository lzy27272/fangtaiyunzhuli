package cn.sifangguan.ota.api.sprint2.intake;

public final class ConnectorIntakeStorageUnavailableException extends RuntimeException {
    public ConnectorIntakeStorageUnavailableException() {
        super("Sprint 2 connector intake storage is not available");
    }
}
