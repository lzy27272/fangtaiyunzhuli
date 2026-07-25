package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.connector.DataStreamType;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.SimpleTransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JdbcApprovedConnectorContractBaselineReaderTest {
    private static final ConnectorContractApprovalKey KEY =
            new ConnectorContractApprovalKey(
                    UUID.fromString("51000000-0000-4000-8000-000000000001"),
                    UUID.fromString("51000000-0000-4000-8000-000000000002"),
                    UUID.fromString("51000000-0000-4000-8000-000000000003"),
                    UUID.fromString("51000000-0000-4000-8000-000000000004"),
                    DataStreamType.BOOKING_EVENT);

    @Test
    void readsOnlyTheNarrowEffectiveBaselineFunctionWithExactKey() {
        var approval = new PersistedConnectorContractApproval(
                "future.external.pms",
                "vendor-adapter-v1",
                "SHA-256-V1",
                "a".repeat(64),
                "b".repeat(64),
                "APPROVED",
                "ACTIVE");
        var database = new RecordingJdbcTemplate(List.of(approval));
        var transactionManager = new RecordingTransactionManager();
        var reader = new JdbcApprovedConnectorContractBaselineReader(
                database,
                new TransactionTemplate(transactionManager));

        var loaded = reader.findApprovedBaseline(KEY);

        assertEquals(approval, loaded.orElseThrow());
        assertTrue(database.querySql.contains(
                "control.read_effective_connector_contract_baseline"));
        assertFalse(database.querySql.contains(
                "ota.connector_contract_approved_baseline"));
        assertFalse(database.querySql.contains(
                "ota.hotel_source_connector"));
        assertEquals(
                List.of(
                        KEY.tenantId(),
                        KEY.hotelId(),
                        KEY.connectorId(),
                        KEY.connectorVersionId(),
                        KEY.stream().name()),
                List.of(database.queryArguments));
        assertEquals(KEY.tenantId().toString(), database.configuredTenant);
        assertEquals(1, transactionManager.commits);
        assertEquals(0, transactionManager.rollbacks);
    }

    @Test
    void zeroFunctionRowsMeansMissingApproval() {
        var database = new RecordingJdbcTemplate(List.of());
        var transactionManager = new RecordingTransactionManager();
        var reader = new JdbcApprovedConnectorContractBaselineReader(
                database,
                new TransactionTemplate(transactionManager));

        assertTrue(reader.findApprovedBaseline(KEY).isEmpty());
        assertEquals(1, transactionManager.commits);
    }

    @Test
    void multipleFunctionRowsFailClosedAndRollback() {
        var approval = new PersistedConnectorContractApproval(
                "future.external.pms",
                "vendor-adapter-v1",
                "SHA-256-V1",
                "a".repeat(64),
                "b".repeat(64),
                "APPROVED",
                "ACTIVE");
        var database = new RecordingJdbcTemplate(
                List.of(approval, approval));
        var transactionManager = new RecordingTransactionManager();
        var reader = new JdbcApprovedConnectorContractBaselineReader(
                database,
                new TransactionTemplate(transactionManager));

        var failure = assertThrows(
                IllegalStateException.class,
                () -> reader.findApprovedBaseline(KEY));

        assertEquals(
                "CONNECTOR_CONTRACT_BASELINE_NOT_UNIQUE",
                failure.getMessage());
        assertEquals(0, transactionManager.commits);
        assertEquals(1, transactionManager.rollbacks);
    }

    private static final class RecordingJdbcTemplate extends JdbcTemplate {
        private final List<PersistedConnectorContractApproval> rows;
        private String configuredTenant;
        private String querySql;
        private Object[] queryArguments;

        private RecordingJdbcTemplate(
                List<PersistedConnectorContractApproval> rows) {
            this.rows = List.copyOf(rows);
        }

        @Override
        public <T> T queryForObject(
                String sql,
                Class<T> requiredType,
                Object... args) {
            if (!sql.contains("set_config('app.tenant_id'")) {
                throw new AssertionError("unexpected queryForObject: " + sql);
            }
            configuredTenant = args[0].toString();
            return requiredType.cast(configuredTenant);
        }

        @Override
        public <T> List<T> query(
                String sql,
                RowMapper<T> rowMapper,
                Object... args) {
            querySql = sql;
            queryArguments = args;
            var mapped = new ArrayList<T>();
            for (var approval : rows) {
                var resultSet = mock(ResultSet.class);
                try {
                    when(resultSet.getString("connector_code"))
                            .thenReturn(approval.connectorCode());
                    when(resultSet.getString("adapter_version"))
                            .thenReturn(approval.adapterVersion());
                    when(resultSet.getString("fingerprint_algorithm"))
                            .thenReturn(approval.fingerprintAlgorithm());
                    when(resultSet.getString("capability_fingerprint"))
                            .thenReturn(approval.capabilityFingerprint());
                    when(resultSet.getString("schema_fingerprint"))
                            .thenReturn(approval.schemaFingerprint());
                    when(resultSet.getString("approval_status"))
                            .thenReturn(approval.approvalStatus());
                    when(resultSet.getString("connector_version_status"))
                            .thenReturn(approval.connectorVersionStatus());
                    mapped.add(rowMapper.mapRow(resultSet, mapped.size()));
                } catch (SQLException sqlFailure) {
                    throw new IllegalStateException(
                            "test row mapping failed",
                            sqlFailure);
                }
            }
            return mapped;
        }
    }

    private static final class RecordingTransactionManager
            implements PlatformTransactionManager {
        private int commits;
        private int rollbacks;

        @Override
        public TransactionStatus getTransaction(
                TransactionDefinition definition) {
            return new SimpleTransactionStatus();
        }

        @Override
        public void commit(TransactionStatus status) {
            commits++;
        }

        @Override
        public void rollback(TransactionStatus status) {
            rollbacks++;
        }
    }
}
