package cn.sifangguan.ota.api.auth.adapter;

import org.junit.jupiter.api.Test;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;
import java.lang.reflect.Modifier;

import static org.assertj.core.api.Assertions.assertThat;

class RepositoryTransactionBoundaryTest {
    @Test
    void everyJdbcWriteEntryPointDeclaresAnExplicitTransaction() throws Exception {
        assertTransactional(JdbcAccountRepository.class, "createPlatformAdmin",
                cn.sifangguan.ota.api.auth.domain.LocalAccount.class,
                cn.sifangguan.ota.api.auth.domain.AccountCredential.class);
        assertTransactional(JdbcAccountRepository.class, "recordLoginFailure", UUID.class, Instant.class);
        assertTransactional(JdbcAccountRepository.class, "recordLoginSuccess", UUID.class);
        assertTransactional(JdbcAuthSessionRepository.class, "create",
                cn.sifangguan.ota.api.auth.domain.AuthSession.class);
        assertTransactional(JdbcAuthSessionRepository.class, "rotate", String.class,
                cn.sifangguan.ota.api.auth.domain.AuthSession.class, Instant.class);
        assertTransactional(JdbcAuthSessionRepository.class, "revokeFamily",
                UUID.class, Instant.class, String.class);
        assertTransactional(JdbcAuthSessionRepository.class, "revokeAllForAccount",
                UUID.class, Instant.class, String.class);
    }

    @Test
    void authenticationAndBootstrapOwnAtomicServiceTransactions() throws Exception {
        assertTransactional(cn.sifangguan.ota.api.auth.application.AuthenticationService.class,
                "login", String.class, char[].class, String.class, String.class);
        assertTransactional(cn.sifangguan.ota.api.auth.application.AuthenticationService.class,
                "refresh", String.class, String.class);
        assertTransactional(cn.sifangguan.ota.api.auth.application.AuthenticationService.class,
                "logout", String.class, String.class);
        assertTransactional(cn.sifangguan.ota.api.auth.application.AuthenticationService.class,
                "revokeAllSessions", UUID.class, String.class, String.class);
        assertTransactional(cn.sifangguan.ota.api.auth.application.BootstrapPlatformAdminService.class,
                "bootstrap", String.class, String.class, char[].class, String.class);
        Transactional inCurrent = cn.sifangguan.ota.api.audit.JdbcAuditPort.class
                .getMethod("appendInCurrentTransaction", cn.sifangguan.ota.api.audit.AuditEvent.class)
                .getAnnotation(Transactional.class);
        assertThat(inCurrent).isNotNull();
        assertThat(inCurrent.propagation())
                .isEqualTo(org.springframework.transaction.annotation.Propagation.MANDATORY);
        assertThat(Modifier.isFinal(JdbcAccountRepository.class.getModifiers())).isFalse();
        assertThat(Modifier.isFinal(JdbcAuthSessionRepository.class.getModifiers())).isFalse();
        assertThat(Modifier.isFinal(cn.sifangguan.ota.api.audit.JdbcAuditPort.class.getModifiers())).isFalse();
    }

    private static void assertTransactional(
            Class<?> type,
            String method,
            Class<?>... parameters
    ) throws Exception {
        assertThat(type.getMethod(method, parameters).isAnnotationPresent(Transactional.class))
                .as(type.getSimpleName() + "." + method + " must commit with Hikari autoCommit=false")
                .isTrue();
    }
}
