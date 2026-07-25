package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;

import java.util.Set;
import java.util.UUID;

public record AccountView(UUID id, String displayName, Set<OtaRole> roles) {
    public AccountView {
        roles = Set.copyOf(roles);
    }

    public static AccountView from(LocalAccount account) {
        return new AccountView(account.id(), account.displayName(), account.roles());
    }
}
