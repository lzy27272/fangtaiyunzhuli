package cn.sifangguan.ota.api.auth.domain;

import java.util.Objects;

public record AccountWithCredential(LocalAccount account, AccountCredential credential) {
    public AccountWithCredential {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(credential, "credential");
        if (!account.id().equals(credential.accountId())) {
            throw new IllegalArgumentException("Credential does not belong to account");
        }
    }
}
