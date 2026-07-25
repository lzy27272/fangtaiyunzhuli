package cn.sifangguan.ota.api.sprint1.web;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import cn.sifangguan.ota.api.sprint1.application.Sprint1ControlPlaneService;
import cn.sifangguan.ota.api.sprint1.catalog.ConnectorAdapterDirectory;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class Sprint1ControllerContractTest {
    private Sprint1ControlPlaneService service;
    private MockMvc mvc;
    private AccountView account;
    private UsernamePasswordAuthenticationToken authentication;

    @BeforeEach
    void setUp() {
        service = mock(Sprint1ControlPlaneService.class);
        mvc = MockMvcBuilders.standaloneSetup(
                        new Sprint1Controller(new ConnectorAdapterDirectory(), service))
                .setControllerAdvice(new Sprint1ExceptionHandler())
                .build();
        account = new AccountView(
                UUID.randomUUID(), "Admin", Set.of(OtaRole.PLATFORM_ADMIN));
        authentication = UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedAccountPrincipal(account, UUID.randomUUID()), null, List.of());
    }

    @Test
    void adapterDirectoryUsesStableDataEnvelopeAndOfficialExportSource() throws Exception {
        mvc.perform(get("/api/v1/ota/connector-adapters").principal(authentication))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.length()").value(4))
                .andExpect(jsonPath("$.data[3].code").value("FILE_FIXTURE"))
                .andExpect(jsonPath("$.data[3].sourceSystem").value("OFFICIAL_EXPORT"));
    }

    @Test
    void simulationRunRouteRequiresIdempotencyEnvelopeAndReturnsAcceptedReceipt() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        when(service.deterministicSimulationRunId(
                tenantId, hotelId, "simulation-run-0001")).thenReturn(runId);
        when(service.execute(
                eq(account), eq(tenantId), eq(0L), eq("MANUAL_SIMULATION"),
                eq("simulation-run-0001"), any(Sprint1Mutations.TriggerSimulation.class),
                anyString()))
                .thenReturn(new Sprint1Views.CommandReceipt(
                        "command-1", runId, 0, false));

        mvc.perform(post("/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs",
                        tenantId, hotelId)
                        .principal(authentication)
                        .header("Idempotency-Key", "simulation-run-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "MANUAL_SIMULATION",
                                  "scenarioCode": "BASELINE"
                                }
                                """))
                .andExpect(status().isAccepted())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data.commandId").value("command-1"))
                .andExpect(jsonPath("$.data.resourceId").value(runId.toString()))
                .andExpect(jsonPath("$.data.replayed").value(false));
    }

    @Test
    void configurationRouteReturnsStableIdentifiersAndNeverRequiresASecretValue() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        Sprint1Views.ConfigurationView view = new Sprint1Views.ConfigurationView(
                new Sprint1Views.TenantView(
                        tenantId, "PILOT", "Pilot", "Asia/Shanghai", "DRAFT", 0),
                new Sprint1Views.HotelView(
                        tenantId, hotelId, "HOTEL", "Hotel", "Asia/Shanghai",
                        "READY_FOR_TEST", true, false, 0),
                List.of(new Sprint1Views.ConnectorView(
                        UUID.randomUUID(), "MOCK_PMS", "PMS", true, "BASELINE", 60, 0,
                        new Sprint1Views.SecretReferenceStatus(
                                false, null, "NOT_REQUIRED", null))),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                List.of(),
                true,
                true);
        when(service.configuration(account, tenantId, hotelId)).thenReturn(view);

        mvc.perform(get(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration",
                        tenantId, hotelId)
                        .principal(authentication))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.tenant.tenantId").value(tenantId.toString()))
                .andExpect(jsonPath("$.data.hotel.hotelId").value(hotelId.toString()))
                .andExpect(jsonPath("$.data.connectors[0].adapterCode").value("MOCK_PMS"))
                .andExpect(jsonPath("$.data.connectors[0].secret.referenceConfigured").value(false))
                .andExpect(jsonPath("$.data.outboundDeliveryBlocked").value(true))
                .andExpect(jsonPath("$.data.connectors[0].secret.secretReference").doesNotExist());
    }

    @Test
    void connectorRouteRejectsUnregisteredImplementationBeforePersistence() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();

        mvc.perform(post(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/connectors/{connectorId}",
                        tenantId, hotelId, connectorId)
                        .principal(authentication)
                        .header("Idempotency-Key", "connector-command-0001")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRowVersion": 0,
                                  "reasonCode": "SIMULATION_CONFIG",
                                  "adapterCode": "https://example.test/adapter",
                                  "sourceCode": "PMS",
                                  "enabled": true,
                                  "fixtureScenarioCode": "BASELINE",
                                  "pollIntervalMinutes": 60
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
    }
}
