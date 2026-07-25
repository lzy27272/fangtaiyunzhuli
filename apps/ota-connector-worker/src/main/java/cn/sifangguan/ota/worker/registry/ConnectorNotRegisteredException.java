package cn.sifangguan.ota.worker.registry;

public final class ConnectorNotRegisteredException extends RuntimeException {
    public ConnectorNotRegisteredException(String connectorCode) {
        super("connector is not registered: " + connectorCode);
    }
}
