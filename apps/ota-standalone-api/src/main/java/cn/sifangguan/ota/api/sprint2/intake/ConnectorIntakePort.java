package cn.sifangguan.ota.api.sprint2.intake;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

/**
 * Persistence boundary for the offline intake control plane.
 *
 * Implementations must enforce idempotencyKey/requestHash consistency and
 * expectedRowVersion atomically inside the caller's tenant transaction.
 */
public interface ConnectorIntakePort {
    List<ConnectorDraftView> listDrafts(UUID hotelId);

    Optional<ConnectorDraftView> findDraft(UUID hotelId, SourceCode sourceCode);

    CommandReceipt saveDraft(SaveDraftCommand command);
}
