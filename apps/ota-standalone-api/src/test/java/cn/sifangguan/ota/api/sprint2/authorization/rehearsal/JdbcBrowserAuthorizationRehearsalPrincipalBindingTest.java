package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class JdbcBrowserAuthorizationRehearsalPrincipalBindingTest {
    private static final String ACCOUNT_CONTEXT_SQL =
            "select set_config('app.account_id', ?, true)";
    private static final String SESSION_CONTEXT_SQL =
            "select set_config('app.auth_session_id', ?, true)";

    @Test
    void realJdbcAdapterBindsTheTrustedSessionAfterTheActorInOneContext() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID actorAccountId = UUID.randomUUID();
        UUID trustedSessionId = UUID.randomUUID();
        when(jdbc.queryForObject(
                ACCOUNT_CONTEXT_SQL,
                String.class,
                actorAccountId.toString()))
                .thenReturn(actorAccountId.toString());
        when(jdbc.queryForObject(
                SESSION_CONTEXT_SQL,
                String.class,
                trustedSessionId.toString()))
                .thenReturn(trustedSessionId.toString());

        new JdbcBrowserAuthorizationRehearsalPort(jdbc)
                .bindAuthenticatedPrincipal(
                        actorAccountId,
                        trustedSessionId);

        InOrder ordered = inOrder(jdbc);
        ordered.verify(jdbc).queryForObject(
                ACCOUNT_CONTEXT_SQL,
                String.class,
                actorAccountId.toString());
        ordered.verify(jdbc).queryForObject(
                SESSION_CONTEXT_SQL,
                String.class,
                trustedSessionId.toString());
        ordered.verifyNoMoreInteractions();
    }

    @Test
    void missingTrustedSessionFailsBeforeAnyJdbcContextMutation() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);

        assertThatThrownBy(() ->
                new JdbcBrowserAuthorizationRehearsalPort(jdbc)
                        .bindAuthenticatedPrincipal(
                                UUID.randomUUID(),
                                null))
                .isInstanceOf(SecurityException.class)
                .hasMessage("Authenticated principal context is required");

        verifyNoInteractions(jdbc);
    }

    @Test
    void jdbcConfirmationMismatchFailsClosedInsteadOfAcceptingASpoofedSession() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID actorAccountId = UUID.randomUUID();
        UUID trustedSessionId = UUID.randomUUID();
        when(jdbc.queryForObject(
                ACCOUNT_CONTEXT_SQL,
                String.class,
                actorAccountId.toString()))
                .thenReturn(actorAccountId.toString());
        when(jdbc.queryForObject(
                SESSION_CONTEXT_SQL,
                String.class,
                trustedSessionId.toString()))
                .thenReturn(UUID.randomUUID().toString());

        assertThatThrownBy(() ->
                new JdbcBrowserAuthorizationRehearsalPort(jdbc)
                        .bindAuthenticatedPrincipal(
                                actorAccountId,
                                trustedSessionId))
                .isInstanceOf(SecurityException.class)
                .hasMessage(
                        "Database authenticated session context was not established");
    }
}
