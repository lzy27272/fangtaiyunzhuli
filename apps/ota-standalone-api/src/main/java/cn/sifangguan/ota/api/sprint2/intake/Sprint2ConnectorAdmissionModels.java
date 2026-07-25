package cn.sifangguan.ota.api.sprint2.intake;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

/**
 * Secret-free, read-only admission readiness models for configuration-only
 * connector drafts.
 */
public final class Sprint2ConnectorAdmissionModels {
    private Sprint2ConnectorAdmissionModels() {
    }

    public enum AdmissionState {
        CANDIDATE_UNAVAILABLE
    }

    public record ConnectorContractAdmissionView(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            SourceCode sourceCode,
            String templateCode,
            String adapterVersion,
            AdmissionState admissionState,
            boolean candidateAvailable,
            boolean approvalAvailable,
            boolean revocationAvailable,
            boolean runtimeBlocked,
            long admissionRowVersion,
            List<String> blockers
    ) {
        private static final String CANDIDATE_BLOCKER =
                "SERVER_OWNED_CONTRACT_CANDIDATE_UNAVAILABLE";
        private static final String RUNTIME_BLOCKER =
                "CONFIGURATION_ONLY_NOT_EXECUTABLE";

        public ConnectorContractAdmissionView {
            Objects.requireNonNull(tenantId, "tenantId");
            Objects.requireNonNull(hotelId, "hotelId");
            Objects.requireNonNull(connectorId, "connectorId");
            Objects.requireNonNull(connectorVersionId, "connectorVersionId");
            Objects.requireNonNull(sourceCode, "sourceCode");
            templateCode = requireText(templateCode, "templateCode");
            adapterVersion = requireText(adapterVersion, "adapterVersion");
            Objects.requireNonNull(admissionState, "admissionState");
            blockers = List.copyOf(Objects.requireNonNull(blockers, "blockers"));

            if (admissionState != AdmissionState.CANDIDATE_UNAVAILABLE
                    || candidateAvailable
                    || approvalAvailable
                    || revocationAvailable
                    || !runtimeBlocked
                    || admissionRowVersion != 0
                    || !blockers.contains(CANDIDATE_BLOCKER)
                    || !blockers.contains(RUNTIME_BLOCKER)) {
                throw new IllegalArgumentException(
                        "Sprint 2C admission readiness must remain unavailable "
                                + "and runtime-blocked");
            }
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
