package cn.sifangguan.ota.api.auth.application;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.AccountCredential;
import cn.sifangguan.ota.api.auth.domain.AccountStatus;
import cn.sifangguan.ota.api.auth.domain.LocalAccount;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.port.AccountRepository;

import java.time.Clock;
import java.util.Arrays;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.transaction.annotation.Transactional;

public class BootstrapPlatformAdminService {
    private static final Pattern LOGIN_NAME = Pattern.compile("[a-z0-9][a-z0-9._-]{2,63}");
    private final AccountRepository accounts;
    private final PasswordHasher passwordHasher;
    private final AuditPort audit;
    private final Clock clock;

    public BootstrapPlatformAdminService(
            AccountRepository accounts,
            PasswordHasher passwordHasher,
            AuditPort audit,
            Clock clock
    ) {
        this.accounts = accounts;
        this.passwordHasher = passwordHasher;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional
    public UUID bootstrap(String username, String displayName, char[] password, String correlationId) {
        String canonical = username == null ? "" : username.strip().toLowerCase(Locale.ROOT);
        try {
            if (accounts.hasAnyAccount()) {
                throw new IllegalStateException("Initial administrator already exists");
            }
            if (!LOGIN_NAME.matcher(canonical).matches()) {
                throw new IllegalArgumentException("Bootstrap login name is invalid");
            }
            if (displayName == null || displayName.isBlank() || displayName.length() > 100) {
                throw new IllegalArgumentException("Bootstrap display name is invalid");
            }
            if (password.length < 16 || password.length > 128
                    || CharSequence.compare(java.nio.CharBuffer.wrap(password), canonical) == 0) {
                throw new IllegalArgumentException("Bootstrap password does not meet the local policy");
            }
            UUID accountId = UUID.randomUUID();
            LocalAccount account = new LocalAccount(
                    accountId, canonical, displayName.strip(), AccountStatus.ACTIVE, 1,
                    Set.of(OtaRole.PLATFORM_ADMIN));
            AccountCredential credential = new AccountCredential(
                    accountId, passwordHasher.hash(password), "ARGON2ID", 0, null);
            accounts.createPlatformAdmin(account, credential);
            audit.appendInCurrentTransaction(new AuditEvent(
                    UUID.randomUUID(), "AUTH_PLATFORM_ADMIN_BOOTSTRAPPED", accountId,
                    "SUCCEEDED", null, correlationId, clock.instant(), "ACCOUNT", accountId,
                    null, null, null, null));
            return accountId;
        } finally {
            Arrays.fill(password, '\0');
        }
    }
}
