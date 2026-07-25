package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.auth.web.AuthenticatedAccountPrincipal;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.EnumSet;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.AdmissionState;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class Sprint2ConnectorAdmissionControllerContractTest {
    private UUID tenantId;
    private UUID hotelId;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();
        UUID connectorVersionId = UUID.randomUUID();
        ConnectorAdmissionReadinessPort port = requestedHotelId -> List.of(
                new ConnectorContractAdmissionView(
                        tenantId,
                        requestedHotelId,
                        connectorId,
                        connectorVersionId,
                        SourceCode.PMS,
                        "PMS_INTAKE",
                        "0.0.0-config-only",
                        AdmissionState.CANDIDATE_UNAVAILABLE,
                        false,
                        false,
                        false,
                        true,
                        0,
                        List.of(
                                "SERVER_OWNED_CONTRACT_CANDIDATE_UNAVAILABLE",
                                "CONFIGURATION_ONLY_NOT_EXECUTABLE")));
        ConnectorAdmissionReadinessService service =
                new ConnectorAdmissionReadinessService(
                        port,
                        new DirectTenantContext());
        mvc = MockMvcBuilders.standaloneSetup(
                        new Sprint2ConnectorAdmissionController(service))
                .setControllerAdvice(
                        new Sprint2ConnectorIntakeExceptionHandler())
                .build();
    }

    @Test
    void responseIsReadOnlyUnavailableRuntimeBlockedAndContainsNoSensitiveFields()
            throws Exception {
        mvc.perform(get(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/"
                                + "connector-contract-admissions",
                        tenantId,
                        hotelId)
                        .principal(authentication(OtaRole.PLATFORM_ADMIN)))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(jsonPath("$.data[0].admissionState")
                        .value("CANDIDATE_UNAVAILABLE"))
                .andExpect(jsonPath("$.data[0].candidateAvailable")
                        .value(false))
                .andExpect(jsonPath("$.data[0].approvalAvailable")
                        .value(false))
                .andExpect(jsonPath("$.data[0].revocationAvailable")
                        .value(false))
                .andExpect(jsonPath("$.data[0].runtimeBlocked").value(true))
                .andExpect(jsonPath("$.data[0].admissionRowVersion").value(0))
                .andExpect(jsonPath("$.data[0].capabilityFingerprint")
                        .doesNotExist())
                .andExpect(jsonPath("$.data[0].schemaFingerprint")
                        .doesNotExist())
                .andExpect(jsonPath("$.data[0].secretBindings")
                        .doesNotExist())
                .andExpect(jsonPath("$.data[0].secretReference")
                        .doesNotExist())
                .andExpect(jsonPath("$.data[0].actorAccountId")
                        .doesNotExist());
    }

    @Test
    void hotelScopedRolesReceiveForbidden() throws Exception {
        for (OtaRole role : List.of(
                OtaRole.REVENUE_MANAGER,
                OtaRole.HOTEL_P1_HANDLER)) {
            mvc.perform(get(
                            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/"
                                    + "connector-contract-admissions",
                            tenantId,
                            hotelId)
                            .principal(authentication(role)))
                    .andExpect(status().isForbidden())
                    .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
        }
    }

    private static UsernamePasswordAuthenticationToken authentication(
            OtaRole role
    ) {
        AccountView account = new AccountView(
                UUID.randomUUID(),
                role.name(),
                EnumSet.of(role));
        return UsernamePasswordAuthenticationToken.authenticated(
                new AuthenticatedAccountPrincipal(account, UUID.randomUUID()),
                null,
                List.of());
    }

    private static final class DirectTenantContext
            implements TenantContextExecutor {
        @Override
        public <T> T inTenant(
                UUID tenantId,
                boolean readOnly,
                Supplier<T> work
        ) {
            if (!readOnly) {
                throw new AssertionError(
                        "Admission readiness must use a read-only transaction");
            }
            return work.get();
        }
    }
}
