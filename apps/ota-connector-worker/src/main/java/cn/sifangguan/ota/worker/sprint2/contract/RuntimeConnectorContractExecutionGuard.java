package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.filefixture.FileFixtureConnector;
import cn.sifangguan.ota.worker.job.ClaimedCollectionJob;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractApprovalReason.CONNECTOR_CONTRACT_BASELINE_MISSING;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractApprovalReason.CONNECTOR_CONTRACT_BASELINE_REVOKED;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractApprovalReason.CONNECTOR_CONTRACT_BASELINE_UNAVAILABLE;
import static cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractApprovalReason.CONNECTOR_CONTRACT_FINGERPRINT_ALGORITHM_UNSUPPORTED;

/**
 * Execution-time, persisted approval gate for every non-local connector.
 *
 * <p>Only the exact built-in simulation and compiled file-fixture classes are
 * exempt. Any future connector class therefore fails closed unless exactly one
 * persistent reader is configured and its version/stream baseline remains
 * approved, active, and fingerprint-identical to the runtime descriptor and
 * code-reviewed standard-record schema.</p>
 */
@Component
public final class RuntimeConnectorContractExecutionGuard
        implements ConnectorContractExecutionPreflight {
    private final Supplier<Optional<ApprovedConnectorContractBaselineReader>>
            readerSupplier;
    private final ConnectorContractDriftDetector driftDetector;
    private final ApprovedStandardRecordSchemaCatalog schemaCatalog;

    @Autowired
    public RuntimeConnectorContractExecutionGuard(
            ObjectProvider<ApprovedConnectorContractBaselineReader> readers,
            ConnectorContractDriftDetector driftDetector,
            ApprovedStandardRecordSchemaCatalog schemaCatalog) {
        this(
                () -> {
                    var configured = readers.orderedStream().toList();
                    return configured.size() == 1
                            ? Optional.of(configured.getFirst())
                            : Optional.empty();
                },
                driftDetector,
                schemaCatalog);
    }

    public RuntimeConnectorContractExecutionGuard(
            ApprovedConnectorContractBaselineReader reader) {
        this(
                () -> Optional.of(Objects.requireNonNull(reader, "reader")),
                new ConnectorContractDriftDetector(),
                new ApprovedStandardRecordSchemaCatalog());
    }

    private RuntimeConnectorContractExecutionGuard(
            Supplier<Optional<ApprovedConnectorContractBaselineReader>>
                    readerSupplier,
            ConnectorContractDriftDetector driftDetector,
            ApprovedStandardRecordSchemaCatalog schemaCatalog) {
        this.readerSupplier = Objects.requireNonNull(
                readerSupplier,
                "readerSupplier");
        this.driftDetector = Objects.requireNonNull(
                driftDetector,
                "driftDetector");
        this.schemaCatalog = Objects.requireNonNull(
                schemaCatalog,
                "schemaCatalog");
    }

    public static RuntimeConnectorContractExecutionGuard
            failClosedWithoutPersistentReader() {
        return new RuntimeConnectorContractExecutionGuard(
                Optional::<ApprovedConnectorContractBaselineReader>empty,
                new ConnectorContractDriftDetector(),
                new ApprovedStandardRecordSchemaCatalog());
    }

    @Override
    public void verifyBeforeExecution(
            ClaimedCollectionJob job,
            SourceConnector connector) {
        Objects.requireNonNull(job, "job");
        Objects.requireNonNull(connector, "connector");
        var descriptor = connector.descriptor();
        if (!job.connectorCode().equals(descriptor.connectorCode())) {
            throw new ConnectorContractDriftException(
                    ConnectorContractDriftReason.CONNECTOR_IDENTITY_DRIFT);
        }
        if (isExactLocalOnlyConnector(connector)) {
            return;
        }
        var reader = configuredReader();
        var key = new ConnectorContractApprovalKey(
                job.request().scope().tenantId(),
                job.request().scope().hotelId(),
                job.request().connectorId(),
                job.connectorVersionId(),
                job.request().stream());
        final Optional<PersistedConnectorContractApproval> loaded;
        try {
            loaded = reader.findApprovedBaseline(key);
        } catch (RuntimeException ignored) {
            reject(CONNECTOR_CONTRACT_BASELINE_UNAVAILABLE);
            return;
        }
        var approval = loaded.orElseThrow(() ->
                new ConnectorContractApprovalException(
                        CONNECTOR_CONTRACT_BASELINE_MISSING));
        if (!PersistedConnectorContractApproval
                .SUPPORTED_FINGERPRINT_ALGORITHM
                .equals(approval.fingerprintAlgorithm())) {
            reject(CONNECTOR_CONTRACT_FINGERPRINT_ALGORITHM_UNSUPPORTED);
        }
        if (!approval.isApprovedAndActive()) {
            reject(CONNECTOR_CONTRACT_BASELINE_REVOKED);
        }
        driftDetector.verify(
                descriptor,
                schemaCatalog.schemasFor(job.request().stream()),
                approval.asContractBaseline());
    }

    private ApprovedConnectorContractBaselineReader configuredReader() {
        try {
            return readerSupplier.get().orElseThrow(() ->
                    new ConnectorContractApprovalException(
                            CONNECTOR_CONTRACT_BASELINE_UNAVAILABLE));
        } catch (ConnectorContractApprovalException known) {
            throw known;
        } catch (RuntimeException ignored) {
            throw new ConnectorContractApprovalException(
                    CONNECTOR_CONTRACT_BASELINE_UNAVAILABLE);
        }
    }

    private static boolean isExactLocalOnlyConnector(
            SourceConnector connector) {
        var connectorClass = connector.getClass();
        return connectorClass == SimulationPmsConnector.class
                || connectorClass == SimulationCtripConnector.class
                || connectorClass == SimulationMeituanConnector.class
                || connectorClass == FileFixtureConnector.class;
    }

    private static void reject(ConnectorContractApprovalReason reason) {
        throw new ConnectorContractApprovalException(reason);
    }
}
