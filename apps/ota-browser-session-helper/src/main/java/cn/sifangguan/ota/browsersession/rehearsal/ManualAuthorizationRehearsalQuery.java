package cn.sifangguan.ota.browsersession.rehearsal;

import java.util.Objects;

public record ManualAuthorizationRehearsalQuery(
        ManualAuthorizationRehearsalRequestBinding requestBinding) {

    public ManualAuthorizationRehearsalQuery {
        Objects.requireNonNull(requestBinding, "requestBinding");
    }
}
