package cn.sifangguan.ota.api.auth.port;

import cn.sifangguan.ota.api.auth.domain.AccountCredential;
import cn.sifangguan.ota.api.auth.domain.AccountWithCredential;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface AccountRepository {
    Optional<AccountWithCredential> findForLogin(String canonicalUsername);

    Optional<LocalAccount> findById(UUID accountId);

    boolean hasAnyAccount();

    void createPlatformAdmin(LocalAccount account, AccountCredential credential);

    void recordLoginFailure(UUID accountId, Instant attemptedAt);

    void recordLoginSuccess(UUID accountId);
}
