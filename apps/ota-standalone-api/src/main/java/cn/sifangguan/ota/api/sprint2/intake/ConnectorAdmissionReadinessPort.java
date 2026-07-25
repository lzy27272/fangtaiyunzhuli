package cn.sifangguan.ota.api.sprint2.intake;

import java.util.List;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;

/**
 * Read-only persistence boundary for connector contract admission readiness.
 */
public interface ConnectorAdmissionReadinessPort {
    List<ConnectorContractAdmissionView> listReadiness(UUID hotelId);
}
