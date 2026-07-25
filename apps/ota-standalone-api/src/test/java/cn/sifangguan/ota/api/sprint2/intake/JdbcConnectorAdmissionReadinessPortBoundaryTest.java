package cn.sifangguan.ota.api.sprint2.intake;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class JdbcConnectorAdmissionReadinessPortBoundaryTest {
    @Test
    void queryReadsOnlyConfigurationDraftIdentityAndVersionMetadata() {
        assertThat(JdbcConnectorAdmissionReadinessPort.LIST_READINESS_SQL)
                .contains(
                        "connector_mode = 'CONFIGURATION_ONLY'",
                        "lifecycle_status = 'DRAFT'",
                        "status = 'DRAFT'",
                        "connector_version_id",
                        "adapter_version")
                .doesNotContain(
                        "connector_contract_approved_baseline",
                        "connector_secret_binding",
                        "secret_ref",
                        "secret_fingerprint",
                        "capability_fingerprint",
                        "schema_fingerprint",
                        "connector_collection_schedule",
                        "ota_job_registry",
                        "connector_collection_run");
    }

    @Test
    void adapterContainsNoMutationOrOutboundClient() throws IOException {
        try (var input = getClass().getResourceAsStream(
                "/cn/sifangguan/ota/api/sprint2/intake/"
                        + "JdbcConnectorAdmissionReadinessPort.class")) {
            assertThat(input).isNotNull();
            String bytecode = new String(
                    input.readAllBytes(),
                    StandardCharsets.ISO_8859_1);
            assertThat(bytecode)
                    .contains("CANDIDATE_UNAVAILABLE")
                    .contains("CONFIGURATION_ONLY_NOT_EXECUTABLE")
                    .doesNotContain("insert into")
                    .doesNotContain("update ota.")
                    .doesNotContain("delete from")
                    .doesNotContain("RestTemplate")
                    .doesNotContain("WebClient")
                    .doesNotContain("HttpClient");
        }
    }
}
