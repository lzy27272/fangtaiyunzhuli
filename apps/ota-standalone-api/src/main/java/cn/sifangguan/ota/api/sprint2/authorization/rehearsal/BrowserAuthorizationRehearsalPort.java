package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import java.util.Optional;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.ConnectorDraftBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.PortResult;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;

public interface BrowserAuthorizationRehearsalPort {
    Optional<ConnectorDraftBinding> findConnectorDraft(
            UUID hotelId,
            UUID connectorId);

    Optional<StoredAttempt> findAttempt(
            UUID hotelId,
            UUID connectorId,
            UUID authorizationAttemptId);

    Optional<StoredAttempt> findLatestAttempt(
            UUID hotelId,
            UUID connectorId);

    PortResult start(StartCommand command);

    PortResult transition(TransitionCommand command);
}
