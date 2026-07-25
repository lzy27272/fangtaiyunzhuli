package cn.sifangguan.ota.browsersession.rehearsal;

import cn.sifangguan.ota.browsersession.BrowserSessionBinding;

import java.util.Objects;
import java.util.UUID;

/**
 * Exact immutable identity of one offline rehearsal.
 */
public record ManualAuthorizationRehearsalIdentity(
        UUID rehearsalId,
        BrowserSessionBinding sessionBinding) {

    public ManualAuthorizationRehearsalIdentity {
        Objects.requireNonNull(rehearsalId, "rehearsalId");
        Objects.requireNonNull(sessionBinding, "sessionBinding");
    }
}
