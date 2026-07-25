package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public interface MessageDeliveryPort {
    DeliveryReceipt deliver(MessageDeliveryCommand command);

    record MessageDeliveryCommand(
            UUID deliveryId,
            TenantHotelRef scope,
            String endpointReference,
            String frozenMessage,
            String shortMessageCode,
            boolean mentionAll,
            Instant deadline) {
        public MessageDeliveryCommand {
            Objects.requireNonNull(deliveryId, "deliveryId");
            Objects.requireNonNull(scope, "scope");
            endpointReference = requireText(endpointReference, "endpointReference");
            frozenMessage = requireText(frozenMessage, "frozenMessage");
            shortMessageCode = requireText(shortMessageCode, "shortMessageCode");
            Objects.requireNonNull(deadline, "deadline");
        }
    }

    record DeliveryReceipt(String providerRequestId, DeliveryOutcome outcome, Instant observedAt) {
        public DeliveryReceipt {
            providerRequestId = Objects.requireNonNullElse(providerRequestId, "");
            Objects.requireNonNull(outcome, "outcome");
            Objects.requireNonNull(observedAt, "observedAt");
        }
    }

    enum DeliveryOutcome {
        DELIVERED,
        FAILED,
        AMBIGUOUS
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
