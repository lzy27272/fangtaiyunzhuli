package cn.sifangguan.ota.api.sprint2.authorization.rehearsal;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.AttemptState;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.ConnectorDraftBinding;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.PortResult;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StartCommand;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.StoredAttempt;
import static cn.sifangguan.ota.api.sprint2.authorization.rehearsal.BrowserAuthorizationRehearsalModels.TransitionCommand;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class BrowserAuthorizationRehearsalControllerContractTest {
    private static final Instant NOW =
            Instant.parse("2026-07-25T09:00:00Z");

    private UUID tenantId;
    private UUID hotelId;
    private UUID connectorId;
    private UUID trustedSessionId;
    private MockMvc mvc;
    private UsernamePasswordAuthenticationToken authentication;
    private FakePort port;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        hotelId = UUID.randomUUID();
        connectorId = UUID.randomUUID();
        UUID actorId = UUID.randomUUID();
        trustedSessionId = UUID.randomUUID();
        port = new FakePort(new ConnectorDraftBinding(
                tenantId,
                hotelId,
                connectorId,
                UUID.randomUUID(),
                3,
                "PMS",
                "PMS_INTAKE",
                "0.0.0-config-only",
                "CONTROLLED_BROWSER",
                true,
                true));
        BrowserAuthorizationRehearsalService service =
                new BrowserAuthorizationRehearsalService(
                        port,
                        new DirectTenantContext(),
                        event -> {
                        },
                        Clock.fixed(NOW, ZoneOffset.UTC),
                        new SecureRandom(),
                        new OfflineRehearsalPolicyAdapter());
        mvc = MockMvcBuilders.standaloneSetup(
                        new BrowserAuthorizationRehearsalController(service))
                .setControllerAdvice(
                        new BrowserAuthorizationRehearsalExceptionHandler())
                .build();
        AccountView account = new AccountView(
                actorId,
                "Admin",
                Set.of(OtaRole.PLATFORM_ADMIN));
        authentication = UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedAccountPrincipal(account, trustedSessionId),
                null,
                List.of());
    }

    @Test
    void startReturnsOnlyOfflineSafetyStateAndNoStore() throws Exception {
        mvc.perform(get(path(""))
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data").value(
                        org.hamcrest.Matchers.nullValue()));

        mvc.perform(post(path(""))
                        .principal(authentication)
                        .header("Idempotency-Key", "rehearsal-start-0001")
                        .header(
                                "X-Auth-Session-ID",
                                UUID.randomUUID().toString())
                        .header("X-Correlation-ID", "correlation-start-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedConfigVersion": 3,
                                  "reasonCode": "START_OFFLINE_REHEARSAL"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.mode")
                        .value("OFFLINE_REHEARSAL"))
                .andExpect(jsonPath("$.data.state")
                        .value("WAITING_FOR_OPERATOR"))
                .andExpect(jsonPath("$.data.authorizationState")
                        .value("AUTH_REQUIRED"))
                .andExpect(jsonPath("$.data.runtimeBlocked").value(true))
                .andExpect(jsonPath("$.data.pmsConnected").value(false))
                .andExpect(jsonPath("$.data.browserStarted").value(false))
                .andExpect(jsonPath("$.data.credentialsRead").value(false))
                .andExpect(jsonPath("$.data.actorAccountId").doesNotExist())
                .andExpect(jsonPath("$.data.interactionReference").doesNotExist())
                .andExpect(jsonPath("$.data.url").doesNotExist());
        assertThat(port.lastTrustedSessionId).isEqualTo(trustedSessionId);

        mvc.perform(get(path(""))
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state")
                        .value("WAITING_FOR_OPERATOR"))
                .andExpect(jsonPath("$.data.authorizationState")
                        .value("AUTH_REQUIRED"));
    }

    @Test
    void inspectAndConfirmNeverReportAuthorized() throws Exception {
        String response = mvc.perform(post(path(""))
                        .principal(authentication)
                        .header("Idempotency-Key", "rehearsal-start-0002")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedConfigVersion": 3,
                                  "reasonCode": "START_OFFLINE_REHEARSAL"
                                }
                                """))
                .andReturn().getResponse().getContentAsString();
        String attemptId = response.replaceFirst(
                ".*\"authorizationAttemptId\":\"([^\"]+)\".*",
                "$1");

        mvc.perform(get(path("/" + attemptId))
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.authorizationState")
                        .value("AUTH_REQUIRED"));

        mvc.perform(post(path("/" + attemptId + "/confirm"))
                        .principal(authentication)
                        .header("Idempotency-Key", "rehearsal-confirm-0002")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "CONFIRM_OFFLINE_REHEARSAL"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.state")
                        .value("OFFLINE_REHEARSAL_COMPLETE"))
                .andExpect(jsonPath("$.data.authorizationState")
                        .value("AUTH_REQUIRED"))
                .andExpect(content().string(
                        org.hamcrest.Matchers.not(
                                org.hamcrest.Matchers.containsString(
                                        "\"AUTHORIZED\""))));
    }

    @Test
    void rejectsSecretLikeAndUnknownFields() throws Exception {
        for (String field : List.of(
                "\"cookie\":\"forbidden\"",
                "\"url\":\"https://invalid.example\"",
                "\"token\":\"forbidden\"",
                "\"sessionId\":\"" + UUID.randomUUID() + "\"")) {
            mvc.perform(post(path(""))
                            .principal(authentication)
                            .header(
                                    "Idempotency-Key",
                                    "rehearsal-invalid-" + UUID.randomUUID())
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("""
                                    {
                                      "expectedConfigVersion": 3,
                                      "reasonCode": "START_OFFLINE_REHEARSAL",
                                      %s
                                    }
                                    """.formatted(field)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
    }

    @Test
    void missingAuthenticationIsDeniedWithoutLeakingDetails() throws Exception {
        mvc.perform(get(path("/" + UUID.randomUUID())))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    private String path(String suffix) {
        return "/api/v1/ota/tenants/" + tenantId
                + "/hotels/" + hotelId
                + "/connector-onboarding/" + connectorId
                + "/browser-authorization-attempts" + suffix;
    }

    private final class DirectTenantContext
            implements TenantContextExecutor {
        @Override
        public <T> T inTenant(
                UUID selectedTenantId,
                boolean readOnly,
                Supplier<T> work
        ) {
            if (!tenantId.equals(selectedTenantId)) {
                throw new SecurityException("Unexpected tenant");
            }
            return work.get();
        }
    }

    private static final class FakePort
            implements BrowserAuthorizationRehearsalPort {
        private final ConnectorDraftBinding binding;
        private final Map<UUID, StoredAttempt> attempts = new HashMap<>();
        private final Map<String, PortResult> receipts = new HashMap<>();
        private UUID lastTrustedSessionId;

        private FakePort(ConnectorDraftBinding binding) {
            this.binding = binding;
        }

        @Override
        public Optional<ConnectorDraftBinding> findConnectorDraft(
                UUID hotelId,
                UUID connectorId
        ) {
            return Optional.of(binding);
        }

        @Override
        public Optional<StoredAttempt> findAttempt(
                UUID hotelId,
                UUID connectorId,
                UUID authorizationAttemptId
        ) {
            return Optional.ofNullable(attempts.get(authorizationAttemptId));
        }

        @Override
        public Optional<StoredAttempt> findLatestAttempt(
                UUID hotelId,
                UUID connectorId
        ) {
            return attempts.values().stream()
                    .filter(attempt -> attempt.hotelId().equals(hotelId)
                            && attempt.connectorId().equals(connectorId))
                    .max(java.util.Comparator.comparing(
                            StoredAttempt::requestedAt));
        }

        @Override
        public PortResult start(StartCommand command) {
            lastTrustedSessionId = command.trustedSessionId();
            PortResult replay = receipts.get(command.idempotencyKey());
            if (replay != null) {
                return new PortResult(
                        replay.commandId(),
                        replay.attempt(),
                        true);
            }
            StoredAttempt attempt = new StoredAttempt(
                    command.tenantId(),
                    command.hotelId(),
                    command.connectorId(),
                    command.binding().connectorVersionId(),
                    command.authorizationAttemptId(),
                    command.actorAccountId(),
                    command.binding().configVersion(),
                    command.binding().adapterCode(),
                    command.binding().adapterVersion(),
                    AttemptState.WAITING_FOR_OPERATOR,
                    command.requestedAt(),
                    command.requestedAt(),
                    command.expiresAt(),
                    null,
                    0);
            attempts.put(attempt.authorizationAttemptId(), attempt);
            PortResult result = new PortResult(
                    UUID.randomUUID(),
                    attempt,
                    false);
            receipts.put(command.idempotencyKey(), result);
            return result;
        }

        @Override
        public PortResult transition(TransitionCommand command) {
            lastTrustedSessionId = command.trustedSessionId();
            StoredAttempt current = attempts.get(
                    command.authorizationAttemptId());
            StoredAttempt changed = new StoredAttempt(
                    current.tenantId(),
                    current.hotelId(),
                    current.connectorId(),
                    current.connectorVersionId(),
                    current.authorizationAttemptId(),
                    current.actorAccountId(),
                    current.configVersion(),
                    current.adapterCode(),
                    current.adapterVersion(),
                    command.targetState(),
                    current.requestedAt(),
                    command.changedAt(),
                    current.expiresAt(),
                    command.changedAt(),
                    current.rowVersion() + 1);
            attempts.put(changed.authorizationAttemptId(), changed);
            return new PortResult(UUID.randomUUID(), changed, false);
        }
    }
}
