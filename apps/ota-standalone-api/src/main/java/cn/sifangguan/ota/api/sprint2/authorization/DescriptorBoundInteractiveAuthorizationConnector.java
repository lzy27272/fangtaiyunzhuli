package cn.sifangguan.ota.api.sprint2.authorization;

import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.AuthorizationProbeResult;
import cn.sifangguan.ota.contracts.connector.ConnectionContext;
import cn.sifangguan.ota.contracts.connector.InteractiveAuthorizationConnector;

import java.util.UUID;

/**
 * Offline control-plane binding that makes connector identity explicit.
 *
 * <p>No implementation is registered by the standalone API. A caller must
 * provide a connector whose descriptor exactly matches the descriptor being
 * authorized.</p>
 */
public interface DescriptorBoundInteractiveAuthorizationConnector
        extends InteractiveAuthorizationConnector {

    ConnectorDescriptor descriptor();

    AuthorizationProbeResult probeAuthorization(
            UUID authorizationAttemptId,
            ConnectionContext context);

    void revokeAuthorization(
            UUID authorizationAttemptId,
            ConnectionContext context);

    /**
     * The authorization control plane must never probe without an attempt id.
     */
    @Override
    default AuthorizationProbeResult probeAuthorization(
            ConnectionContext context
    ) {
        throw new UnsupportedOperationException(
                "Attempt-bound browser authorization probe is required");
    }

    /**
     * The authorization control plane must never revoke without an attempt id.
     */
    @Override
    default void revokeAuthorization(ConnectionContext context) {
        throw new UnsupportedOperationException(
                "Attempt-bound browser authorization revoke is required");
    }
}
