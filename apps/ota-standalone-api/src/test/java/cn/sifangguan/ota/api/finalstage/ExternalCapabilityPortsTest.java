package cn.sifangguan.ota.api.finalstage;

import org.junit.jupiter.api.Test;

import java.util.Map;

import static cn.sifangguan.ota.api.finalstage.ExternalCapabilityPorts.*;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ExternalCapabilityPortsTest {
    @Test
    void defaultModelGatewayIsFailClosed() {
        assertThatThrownBy(() -> new DisabledModelGateway().advise(Map.of("occupancy", 72)))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("MODEL_GATEWAY_DISABLED_PENDING_CONTROLLED_CONFIGURATION");
    }

    @Test
    void defaultPriceWriterIsFailClosed() {
        WriteCommand command = new WriteCommand(
                "preview-1", "request-1", "write-idempotency-1",
                "a".repeat(64), "b".repeat(64));

        assertThatThrownBy(() -> new DisabledStandardRetailPriceWriter().write(command))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("OTA_WRITE_DISABLED_PENDING_AUTHORIZATION_AND_WRITE_UAT");
    }
}
