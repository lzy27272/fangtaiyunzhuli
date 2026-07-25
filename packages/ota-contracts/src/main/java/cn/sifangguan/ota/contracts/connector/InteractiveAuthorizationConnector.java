package cn.sifangguan.ota.contracts.connector;

public interface InteractiveAuthorizationConnector {
    AuthorizationStartResult startAuthorization(AuthorizationContext context);

    AuthorizationProbeResult probeAuthorization(ConnectionContext context);

    void revokeAuthorization(ConnectionContext context);
}
