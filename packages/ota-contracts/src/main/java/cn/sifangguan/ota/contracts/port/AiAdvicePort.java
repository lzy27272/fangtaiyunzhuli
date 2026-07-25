package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

public interface AiAdvicePort {
    AdviceResult requestAdvice(AdviceRequest request);

    record AdviceRequest(
            UUID requestId,
            TenantHotelRef scope,
            UUID frozenBriefId,
            String factsReference,
            Instant deadline) {
        public AdviceRequest {
            Objects.requireNonNull(requestId, "requestId");
            Objects.requireNonNull(scope, "scope");
            Objects.requireNonNull(frozenBriefId, "frozenBriefId");
            factsReference = requireText(factsReference, "factsReference");
            Objects.requireNonNull(deadline, "deadline");
        }
    }

    record AdviceResult(boolean available, Optional<String> advice, String providerCode) {
        public AdviceResult {
            advice = Objects.requireNonNull(advice, "advice");
            providerCode = requireText(providerCode, "providerCode");
            if (available != advice.isPresent()) {
                throw new IllegalArgumentException("available must match advice presence");
            }
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
