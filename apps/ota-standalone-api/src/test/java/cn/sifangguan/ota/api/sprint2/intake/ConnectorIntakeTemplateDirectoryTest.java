package cn.sifangguan.ota.api.sprint2.intake;

import org.junit.jupiter.api.Test;

import java.util.List;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectorIntakeTemplateDirectoryTest {
    private final ConnectorIntakeTemplateDirectory directory =
            new ConnectorIntakeTemplateDirectory();

    @Test
    void exposesThreeStableNonExecutablePreparationTemplates() {
        assertThat(directory.list())
                .extracting(Sprint2ConnectorIntakeModels.IntakeTemplate::templateCode)
                .containsExactly("PMS_INTAKE", "CTRIP_INTAKE", "MEITUAN_INTAKE");
        assertThat(directory.list())
                .allSatisfy(template -> {
                    assertThat(template.executable()).isFalse();
                    assertThat(template.implementationStatus())
                            .isEqualTo("DRAFT_INTAKE_ONLY");
                    assertThat(template.acceptedFields())
                            .containsExactlyElementsOf(
                                    ConnectorIntakeTemplateDirectory.ACCEPTED_FIELDS);
                });
    }

    @Test
    void validatesPerSourceMethodsIntervalsAndOpaqueSecretReferences() {
        var template = directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "VENDOR_A",
                "Vendor A",
                "PMS Suite",
                "8.2",
                "LOCAL_AGENT",
                "HOTEL_001",
                "pilot-alias",
                "ROUTE_AGENT_001",
                5,
                List.of(
                        new SecretBindingInput(
                                "AGENT_MTLS_IDENTITY",
                                "VAULT",
                                "vault://ota/hotel/agent",
                                "v1"),
                        new SecretBindingInput(
                                "PMS_READ_ONLY_CREDENTIAL",
                                "VAULT",
                                "vault://ota/hotel/pms",
                                "v3")));

        assertThat(template.templateCode()).isEqualTo("PMS_INTAKE");
    }

    @Test
    void preparesPmsControlledBrowserOnlyWithAnOpaqueSessionReference() {
        var template = directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "BYH",
                "别样红",
                "PMS",
                "NO_VISIBLE_VERSION",
                "CONTROLLED_BROWSER",
                "HOTEL_001",
                "pilot-read-only",
                "ROUTE_BROWSER_HELPER_001",
                5,
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "OSKEYRING",
                        "oskeyring://ota/uat/hotel/connector/browser-session",
                        "v1")));

        assertThat(template.executable()).isFalse();
        assertThat(template.connectionMethods()).contains("CONTROLLED_BROWSER");
        assertThat(ConnectorIntakeTemplateDirectory.requiredPurposes(
                SourceCode.PMS,
                "CONTROLLED_BROWSER"))
                .containsExactly("BROWSER_SESSION");

        assertThatThrownBy(() -> directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "BYH",
                "别样红",
                "PMS",
                "NO_VISIBLE_VERSION",
                "CONTROLLED_BROWSER",
                "HOTEL_001",
                "pilot-read-only",
                "ROUTE_BROWSER_HELPER_001",
                5,
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "OSKEYRING",
                        "session=value; another=value",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SecretStore");

        assertThatThrownBy(() -> directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "BYH",
                "别样红",
                "PMS",
                "NO_VISIBLE_VERSION",
                "CONTROLLED_BROWSER",
                "HOTEL_001",
                "pilot-read-only",
                "ROUTE_BROWSER_HELPER_001",
                5,
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "ENVREF",
                        "envref://ota/uat/hotel/connector/browser-session",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dedicated");
    }

    @Test
    void requiresEveryPurposeAndRejectsProviderSchemeMismatch() {
        assertThatThrownBy(() -> directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "BYH",
                "别样红",
                "PMS",
                null,
                "CONTROLLED_BROWSER",
                "HOTEL_001",
                "pilot-read-only",
                "ROUTE_BROWSER_HELPER_001",
                5,
                List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("required secret purposes");

        assertThatThrownBy(() -> directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "VENDOR_A",
                "Vendor A",
                "PMS Suite",
                null,
                "LOCAL_AGENT",
                "HOTEL_001",
                "pilot-alias",
                "ROUTE_AGENT_001",
                5,
                List.of(new SecretBindingInput(
                        "AGENT_MTLS_IDENTITY",
                        "VAULT",
                        "vault://ota/hotel/agent",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("required secret purposes");

        assertThatThrownBy(() -> validCtrip(
                "CTRIP_INTAKE",
                "CONTROLLED_BROWSER",
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "VAULT",
                        "oskeyring://ota/ctrip/browser-session",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("reference scheme");

        assertThatThrownBy(() -> validCtrip(
                "CTRIP_INTAKE",
                "CONTROLLED_BROWSER",
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "UNKNOWN_PROVIDER",
                        "vault://ota/ctrip/browser-session",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("reference scheme");
    }

    @Test
    void updateMayOmitAllBindingsButMayNotSubmitAPartialSet() {
        var template = directory.validateUpdate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "VENDOR_A",
                "Vendor A",
                "PMS Suite",
                null,
                "LOCAL_AGENT",
                "HOTEL_001",
                "pilot-alias",
                "ROUTE_AGENT_001",
                5,
                List.of());

        assertThat(template.templateCode()).isEqualTo("PMS_INTAKE");

        assertThatThrownBy(() -> directory.validateUpdate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "VENDOR_A",
                "Vendor A",
                "PMS Suite",
                null,
                "LOCAL_AGENT",
                "HOTEL_001",
                "pilot-alias",
                "ROUTE_AGENT_001",
                5,
                List.of(new SecretBindingInput(
                        "AGENT_MTLS_IDENTITY",
                        "VAULT",
                        "vault://ota/hotel/agent",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("required secret purposes");
    }

    @Test
    void keepsExistingPurposesCompatibleWithMappedProviders() {
        var template = directory.validate(
                "PMS_INTAKE",
                SourceCode.PMS,
                "VENDOR_A",
                "Vendor A",
                "PMS Suite",
                null,
                "OFFICIAL_API",
                "HOTEL_001",
                null,
                "ROUTE_API_001",
                5,
                List.of(new SecretBindingInput(
                        "SOURCE_AUTH",
                        "KMS",
                        "kms://ota/hotel/source-auth",
                        "v1")));

        assertThat(template.templateCode()).isEqualTo("PMS_INTAKE");
    }

    @Test
    void rejectsSourceMismatchUrlPayloadPlaceholdersAndUnexpectedPurpose() {
        assertThatThrownBy(() -> validCtrip(
                "MEITUAN_INTAKE",
                "CONTROLLED_BROWSER",
                List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Template");

        assertThatThrownBy(() -> directory.validate(
                "CTRIP_INTAKE",
                SourceCode.CTRIP,
                "CTRIP",
                "携程",
                "商家后台",
                null,
                "CONTROLLED_BROWSER",
                "https://evil.example/hotel",
                null,
                "ROUTE_CTRIP",
                15,
                List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("externalHotelCode");

        assertThatThrownBy(() -> validCtrip(
                "CTRIP_INTAKE",
                "CONTROLLED_BROWSER",
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "VAULT",
                        "******",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SecretStore");

        assertThatThrownBy(() -> validCtrip(
                "CTRIP_INTAKE",
                "CONTROLLED_BROWSER",
                List.of(new SecretBindingInput(
                        "BROWSER_SESSION",
                        "VAULT",
                        "vault://user:plaintext@store/path",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SecretStore");

        assertThatThrownBy(() -> validCtrip(
                "CTRIP_INTAKE",
                "CONTROLLED_BROWSER",
                List.of(new SecretBindingInput(
                        "SOURCE_AUTH",
                        "VAULT",
                        "vault://ota/ctrip/auth",
                        "v1"))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("purpose");
    }

    private Sprint2ConnectorIntakeModels.IntakeTemplate validCtrip(
            String templateCode,
            String connectionMethod,
            List<SecretBindingInput> bindings
    ) {
        return directory.validate(
                templateCode,
                SourceCode.CTRIP,
                "CTRIP",
                "携程",
                "携程商家后台",
                null,
                connectionMethod,
                "CTRIP_HOTEL_001",
                "hotel-account-alias",
                "ROUTE_CTRIP",
                15,
                bindings);
    }
}
