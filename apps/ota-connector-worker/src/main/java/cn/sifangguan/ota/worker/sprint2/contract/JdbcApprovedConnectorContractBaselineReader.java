package cn.sifangguan.ota.worker.sprint2.contract;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * Tenant-scoped adapter for the narrow effective-baseline database function.
 *
 * <p>The Worker needs EXECUTE only. It intentionally receives no direct
 * SELECT privilege on approval or revocation tables.</p>
 */
public final class JdbcApprovedConnectorContractBaselineReader
        implements ApprovedConnectorContractBaselineReader {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transactions;

    public JdbcApprovedConnectorContractBaselineReader(
            JdbcTemplate jdbc,
            TransactionTemplate transactions) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.transactions = Objects.requireNonNull(transactions, "transactions");
    }

    @Override
    public Optional<PersistedConnectorContractApproval> findApprovedBaseline(
            ConnectorContractApprovalKey key) {
        Objects.requireNonNull(key, "key");
        var loaded = transactions.execute(ignored -> {
            var configuredTenant = jdbc.queryForObject(
                    "SELECT set_config('app.tenant_id', ?, true)",
                    String.class,
                    key.tenantId().toString());
            if (!key.tenantId().toString().equals(configuredTenant)) {
                throw new IllegalStateException(
                        "CONNECTOR_CONTRACT_TENANT_CONTEXT_NOT_SET");
            }
            return query(key);
        });
        if (loaded == null) {
            throw new IllegalStateException(
                    "CONNECTOR_CONTRACT_BASELINE_TRANSACTION_REJECTED");
        }
        return loaded;
    }

    private Optional<PersistedConnectorContractApproval> query(
            ConnectorContractApprovalKey key) {
        List<PersistedConnectorContractApproval> rows = jdbc.query("""
                SELECT connector_code,
                       adapter_version,
                       fingerprint_algorithm,
                       capability_fingerprint,
                       schema_fingerprint,
                       approval_status,
                       connector_version_status
                  FROM control.read_effective_connector_contract_baseline(
                       ?, ?, ?, ?, ?
                )
                """,
                (row, ignored) -> new PersistedConnectorContractApproval(
                        row.getString("connector_code"),
                        row.getString("adapter_version"),
                        row.getString("fingerprint_algorithm"),
                        row.getString("capability_fingerprint"),
                        row.getString("schema_fingerprint"),
                        row.getString("approval_status"),
                        row.getString("connector_version_status")),
                key.tenantId(),
                key.hotelId(),
                key.connectorId(),
                key.connectorVersionId(),
                key.stream().name());
        if (rows.size() > 1) {
            throw new IllegalStateException(
                    "CONNECTOR_CONTRACT_BASELINE_NOT_UNIQUE");
        }
        return rows.stream().findFirst();
    }
}
