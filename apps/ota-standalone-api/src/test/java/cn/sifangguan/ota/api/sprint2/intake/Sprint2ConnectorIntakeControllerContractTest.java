package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.audit.AuditPort;
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
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingStatus;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class Sprint2ConnectorIntakeControllerContractTest {
    private UUID tenantId;
    private UUID hotelId;
    private UUID connectorId;
    private MockMvc mvc;
    private UsernamePasswordAuthenticationToken authentication;
    private FakePort port;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        hotelId = UUID.randomUUID();
        connectorId = UUID.randomUUID();
        port = new FakePort();
        ConnectorIntakeService service = new ConnectorIntakeService(
                new ConnectorIntakeTemplateDirectory(),
                port,
                new DirectTenantContext(),
                event -> {
                },
                Clock.fixed(
                        Instant.parse("2026-07-23T10:00:00Z"),
                        ZoneOffset.UTC));
        mvc = MockMvcBuilders.standaloneSetup(
                        new Sprint2ConnectorIntakeController(service))
                .setControllerAdvice(new Sprint2ConnectorIntakeExceptionHandler())
                .build();
        AccountView account = new AccountView(
                UUID.randomUUID(),
                "Admin",
                Set.of(OtaRole.PLATFORM_ADMIN));
        authentication = UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedAccountPrincipal(account, UUID.randomUUID()),
                null,
                List.of());
        port.drafts = List.of(new ConnectorDraftView(
                tenantId,
                hotelId,
                connectorId,
                SourceCode.CTRIP,
                "CTRIP_INTAKE",
                "CTRIP",
                "携程",
                "携程商家后台",
                null,
                "CONTROLLED_BROWSER",
                "CTRIP_HOTEL_001",
                "hotel-account",
                "ROUTE_CTRIP",
                15,
                List.of(new SecretBindingStatus(
                        "BROWSER_SESSION",
                        "VAULT",
                        true,
                        "CONFIGURED")),
                2,
                "DRAFT",
                "EXTERNAL_INTEGRATION_BLOCKED",
                true,
                List.of(
                        "SECRET_STORE_NOT_CONNECTED",
                        "CONNECTION_TEST_NOT_RUN")));
    }

    @Test
    void exposesStableTemplateCatalogAndNeverMarksItExecutable() throws Exception {
        mvc.perform(get("/api/v1/ota/connector-onboarding/templates")
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.length()").value(3))
                .andExpect(jsonPath("$.data[0].templateCode").value("PMS_INTAKE"))
                .andExpect(jsonPath("$.data[1].templateCode").value("CTRIP_INTAKE"))
                .andExpect(jsonPath("$.data[2].templateCode").value("MEITUAN_INTAKE"))
                .andExpect(jsonPath("$.data[0].executable").value(false));
    }

    @Test
    void getReturnsOnlyNonCorrelatableSecretStatusWithoutOpaqueReference() throws Exception {
        mvc.perform(get(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding",
                        tenantId,
                        hotelId)
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data[0].lifecycle").value("DRAFT"))
                .andExpect(jsonPath("$.data[0].runtimeBlocked").value(true))
                .andExpect(jsonPath("$.data[0].secretBindings[0].purpose")
                        .value("BROWSER_SESSION"))
                .andExpect(jsonPath("$.data[0].secretBindings[0].providerCode")
                        .value("VAULT"))
                .andExpect(jsonPath(
                        "$.data[0].secretBindings[0].fingerprint").doesNotExist())
                .andExpect(jsonPath(
                        "$.data[0].secretBindings[0].configuredAt").doesNotExist())
                .andExpect(jsonPath(
                        "$.data[0].secretBindings[0].rowVersion").doesNotExist())
                .andExpect(jsonPath(
                        "$.data[0].secretBindings[0].secretReference").doesNotExist())
                .andExpect(jsonPath(
                        "$.data[0].secretBindings[0].opaqueSecretReference").doesNotExist());
    }

    @Test
    void postAcceptsOnlyDraftIntakeAndReturnsNoSecretReference() throws Exception {
        mvc.perform(post(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}",
                        tenantId,
                        hotelId,
                        connectorId)
                        .principal(authentication)
                        .header("Idempotency-Key", "connector-intake-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "CONFIGURE_CTRIP",
                                  "templateCode": "CTRIP_INTAKE",
                                  "sourceCode": "CTRIP",
                                  "vendorCode": "CTRIP",
                                  "vendorName": "携程",
                                  "productName": "携程商家后台",
                                  "productVersion": "2026",
                                  "connectionMethod": "CONTROLLED_BROWSER",
                                  "externalHotelCode": "CTRIP_HOTEL_001",
                                  "accountAlias": "hotel-account",
                                  "networkRouteCode": "ROUTE_CTRIP",
                                  "pollIntervalMinutes": 15,
                                  "secretBindings": [
                                    {
                                      "purpose": "BROWSER_SESSION",
                                      "providerCode": "VAULT",
                                      "secretReference": "vault://ota/pilot/ctrip/session",
                                      "secretVersion": "v1"
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.resourceId")
                        .value(connectorId.toString()))
                .andExpect(jsonPath("$.data.secretReference").doesNotExist());
    }

    @Test
    void rejectsUnknownUrlFieldAndHardBlocksTestActivateAndRun() throws Exception {
        mvc.perform(post(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}",
                        tenantId,
                        hotelId,
                        connectorId)
                        .principal(authentication)
                        .header("Idempotency-Key", "connector-intake-0002")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "CONFIGURE_PMS",
                                  "templateCode": "PMS_INTAKE",
                                  "sourceCode": "PMS",
                                  "vendorCode": "PMS_VENDOR",
                                  "vendorName": "PMS Vendor",
                                  "productName": "PMS",
                                  "connectionMethod": "OFFICIAL_API",
                                  "externalHotelCode": "PMS_HOTEL_001",
                                  "networkRouteCode": "ROUTE_PMS",
                                  "pollIntervalMinutes": 5,
                                  "secretBindings": [],
                                  "baseUrl": "https://example.test"
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        mvc.perform(post(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}",
                        tenantId,
                        hotelId,
                        connectorId)
                        .principal(authentication)
                        .header("Idempotency-Key", "connector-intake-0003")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "CONFIGURE_CTRIP",
                                  "templateCode": "CTRIP_INTAKE",
                                  "sourceCode": "CTRIP",
                                  "vendorCode": "CTRIP",
                                  "vendorName": "Ctrip",
                                  "productName": "Merchant Console",
                                  "connectionMethod": "CONTROLLED_BROWSER",
                                  "externalHotelCode": "CTRIP_HOTEL_001",
                                  "networkRouteCode": "ROUTE_CTRIP",
                                  "pollIntervalMinutes": 15,
                                  "secretBindings": [
                                    {
                                      "purpose": "BROWSER_SESSION",
                                      "providerCode": "VAULT",
                                      "secretReference": "vault://ota/pilot/ctrip/session",
                                      "secretVersion": "v1",
                                      "password": "forbidden"
                                    }
                                  ]
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));

        for (String action : List.of("test", "activate", "run")) {
            mvc.perform(post(
                            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/connector-onboarding/{connectorId}/{action}",
                            tenantId,
                            hotelId,
                            connectorId,
                            action)
                            .principal(authentication))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code")
                            .value("SPRINT2_EXTERNAL_ACTION_BLOCKED"));
        }
    }

    private static final class FakePort implements ConnectorIntakePort {
        private List<ConnectorDraftView> drafts = List.of();

        @Override
        public List<ConnectorDraftView> listDrafts(UUID hotelId) {
            return drafts;
        }

        @Override
        public Optional<ConnectorDraftView> findDraft(
                UUID hotelId,
                SourceCode sourceCode
        ) {
            return drafts.stream()
                    .filter(draft -> draft.sourceCode() == sourceCode)
                    .findFirst();
        }

        @Override
        public CommandReceipt saveDraft(SaveDraftCommand command) {
            return new CommandReceipt(
                    "command-0001",
                    command.connectorId(),
                    command.expectedRowVersion() + 1,
                    false);
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
