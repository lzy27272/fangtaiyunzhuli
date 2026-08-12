package cn.sifangguan.ota.api.sprint2.migration;

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

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class CredentialMigrationControllerContractTest {
    private UUID tenantId;
    private UUID hotelId;
    private UUID connectorId;
    private UUID connectorVersionId;
    private UUID rehearsalId;
    private MockMvc mvc;
    private UsernamePasswordAuthenticationToken authentication;
    private FakePort port;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        hotelId = UUID.randomUUID();
        connectorId = UUID.randomUUID();
        connectorVersionId = UUID.randomUUID();
        rehearsalId = UUID.randomUUID();
        port = new FakePort();
        CredentialMigrationService service = new CredentialMigrationService(
                port,
                new DirectTenantContext(),
                event -> {
                },
                Clock.fixed(
                        Instant.parse("2026-08-11T16:00:00Z"),
                        ZoneOffset.UTC));
        mvc = MockMvcBuilders.standaloneSetup(
                        new CredentialMigrationController(service))
                .setControllerAdvice(new CredentialMigrationExceptionHandler())
                .build();
        AccountView account = new AccountView(
                UUID.randomUUID(),
                "Admin",
                Set.of(OtaRole.PLATFORM_ADMIN));
        authentication = UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedAccountPrincipal(account, UUID.randomUUID()),
                null,
                List.of());
        port.views = List.of(new RehearsalView(
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                rehearsalId,
                "SOURCE_AUTH",
                "LEGACY_CLOUD_SERVICE",
                "a".repeat(64),
                "VAULT",
                "v2",
                "sha256:" + "b".repeat(64),
                "METADATA_REHEARSAL_READY",
                false,
                0));
    }

    @Test
    void responseContainsOnlyMetadataAndCannotExecute() throws Exception {
        mvc.perform(get(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals",
                        tenantId,
                        hotelId,
                        connectorId)
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data[0].state")
                        .value("METADATA_REHEARSAL_READY"))
                .andExpect(jsonPath("$.data[0].executionAllowed").value(false))
                .andExpect(jsonPath("$.data[0].secretReference").doesNotExist())
                .andExpect(jsonPath("$.data[0].password").doesNotExist())
                .andExpect(jsonPath("$.data[0].cookie").doesNotExist())
                .andExpect(jsonPath("$.data[0].token").doesNotExist());
    }

    @Test
    void prepareAcceptsOnlyHashesAndReturnsNoBindingReference()
            throws Exception {
        mvc.perform(post(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals",
                        tenantId,
                        hotelId,
                        connectorId)
                        .principal(authentication)
                        .header("Idempotency-Key", "credential-migration-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(validBody()))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.rehearsalId")
                        .value(rehearsalId.toString()))
                .andExpect(jsonPath("$.data.secretReference").doesNotExist())
                .andExpect(jsonPath("$.data.targetBindingId").doesNotExist());
    }

    @Test
    void rejectsRawCredentialAndLegacyLocatorFields() throws Exception {
        for (String forbidden : List.of(
                "\"password\":\"forbidden\"",
                "\"cookie\":\"forbidden\"",
                "\"token\":\"forbidden\"",
                "\"secretReference\":\"vault://forbidden\"",
                "\"sourceLocator\":\"C:/legacy/config.json\"")) {
            String body = validBody().replace(
                    "\n}",
                    ",\n  " + forbidden + "\n}");
            mvc.perform(post(
                            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/credential-migration-rehearsals",
                            tenantId,
                            hotelId,
                            connectorId)
                            .principal(authentication)
                            .header(
                                    "Idempotency-Key",
                                    "credential-migration-forbidden")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
    }

    private String validBody() {
        return """
                {
                  "connectorVersionId": "%s",
                  "expectedBindingRowVersion": 3,
                  "secretPurpose": "SOURCE_AUTH",
                  "sourceSystemCode": "LEGACY_CLOUD_SERVICE",
                  "sourceLocatorHash": "%s",
                  "targetProviderCode": "VAULT",
                  "targetSecretVersion": "v2",
                  "targetSecretFingerprint": "sha256:%s",
                  "reasonCode": "PREPARE_METADATA_REHEARSAL"
                }
                """.formatted(
                connectorVersionId,
                "a".repeat(64),
                "b".repeat(64));
    }

    private final class FakePort implements CredentialMigrationPort {
        private List<RehearsalView> views = List.of();

        @Override
        public List<RehearsalView> list(UUID hotelId, UUID connectorId) {
            return views;
        }

        @Override
        public Receipt prepare(PrepareCommand command) {
            return new Receipt("command-0001", rehearsalId, false);
        }
    }

    private static final class DirectTenantContext
            implements TenantContextExecutor {
        @Override
        public <T> T inTenant(
                UUID tenantId,
                boolean readOnly,
                Supplier<T> work
        ) {
            return work.get();
        }
    }
}
