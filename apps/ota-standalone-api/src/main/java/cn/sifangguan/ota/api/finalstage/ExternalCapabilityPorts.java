package cn.sifangguan.ota.api.finalstage;

import java.util.Map;

public final class ExternalCapabilityPorts {
    private ExternalCapabilityPorts() {
    }

    public interface ModelGateway {
        Map<String, Object> advise(Map<String, Object> redactedStructuredFacts);
    }

    public interface StandardRetailPriceWriter {
        WriteResult write(WriteCommand command);
    }

    public record WriteCommand(
            String previewId,
            String requestId,
            String idempotencyKey,
            String expectedMappingHash,
            String expectedPolicyHash
    ) {
    }

    public record WriteResult(String state, String evidenceHash) {
    }

    public static final class DisabledModelGateway implements ModelGateway {
        @Override
        public Map<String, Object> advise(Map<String, Object> redactedStructuredFacts) {
            throw new IllegalStateException("MODEL_GATEWAY_DISABLED_PENDING_CONTROLLED_CONFIGURATION");
        }
    }

    public static final class DisabledStandardRetailPriceWriter implements StandardRetailPriceWriter {
        @Override
        public WriteResult write(WriteCommand command) {
            throw new IllegalStateException("OTA_WRITE_DISABLED_PENDING_AUTHORIZATION_AND_WRITE_UAT");
        }
    }
}
