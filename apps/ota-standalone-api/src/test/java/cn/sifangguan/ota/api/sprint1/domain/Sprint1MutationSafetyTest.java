package cn.sifangguan.ota.api.sprint1.domain;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

class Sprint1MutationSafetyTest {
    @Test
    void connectorAcceptsOnlyRegisteredCodeSourcePairsAndOpaqueSecretReferences() {
        UUID hotelId = UUID.randomUUID();
        UUID connectorId = UUID.randomUUID();

        assertThatThrownBy(() -> new Sprint1Mutations.UpsertConnector(
                hotelId, connectorId, "FILE_FIXTURE", "FIXTURE",
                true, "BASELINE", 60, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Sprint1Mutations.UpsertConnector(
                hotelId, connectorId, "MOCK_PMS", "PMS",
                true, "BASELINE", 60, "https://example.test/token"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Sprint1Mutations.UpsertConnector(
                hotelId, connectorId, "MOCK_PMS", "PMS",
                true, "BASELINE", 60, "vault://ota/pilot/source?token=value"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Sprint1Mutations.UpsertConnector(
                hotelId, connectorId, "FILE_FIXTURE", "OFFICIAL_EXPORT",
                true, "BASELINE", 60, "vault://ota/pilot/source"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("FILE_FIXTURE");
    }

    @Test
    void hotelMutationCannotEnableExternalMessageDelivery() {
        assertThatThrownBy(() -> new Sprint1Mutations.UpsertHotel(
                UUID.randomUUID(), "PILOT_HOTEL", "Pilot", "Asia/Shanghai",
                "READY_FOR_TEST", true, true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("messageEnabled");
    }
}
