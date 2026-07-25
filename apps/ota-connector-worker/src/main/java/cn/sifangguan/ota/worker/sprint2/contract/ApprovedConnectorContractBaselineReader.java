package cn.sifangguan.ota.worker.sprint2.contract;

import java.util.Optional;

/**
 * Reads the immutable, administrator-approved contract baseline projection.
 *
 * <p>The projection intentionally contains no connector configuration,
 * credentials, secret references, endpoints, or payload data.</p>
 */
@FunctionalInterface
public interface ApprovedConnectorContractBaselineReader {
    Optional<PersistedConnectorContractApproval> findApprovedBaseline(
            ConnectorContractApprovalKey key);
}
