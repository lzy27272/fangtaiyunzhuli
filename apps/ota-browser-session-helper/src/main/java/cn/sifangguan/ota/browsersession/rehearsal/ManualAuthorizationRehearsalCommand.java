package cn.sifangguan.ota.browsersession.rehearsal;

import java.time.Instant;
import java.util.Objects;

/**
 * A closed, non-secret command vocabulary for the offline rehearsal.
 */
public record ManualAuthorizationRehearsalCommand(
        ManualAuthorizationRehearsalRequestBinding requestBinding,
        ManualAuthorizationRehearsalAction action,
        Instant occurredAt) {

    public ManualAuthorizationRehearsalCommand {
        Objects.requireNonNull(requestBinding, "requestBinding");
        Objects.requireNonNull(action, "action");
        Objects.requireNonNull(occurredAt, "occurredAt");
    }
}
