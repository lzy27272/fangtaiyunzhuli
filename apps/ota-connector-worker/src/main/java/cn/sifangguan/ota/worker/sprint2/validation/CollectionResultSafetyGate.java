package cn.sifangguan.ota.worker.sprint2.validation;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;
import cn.sifangguan.ota.contracts.collection.CollectionResult;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.sprint2.contract.RuntimeConnectorContractGuard;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.util.Objects;

/**
 * The single trusted validation boundary for connector results.
 *
 * <p>Both execution and persistence must pass through this gate. A repository
 * caller therefore cannot bypass scope, time, evidence, schema, capability, or
 * drift validation by constructing a {@link CollectionResult} directly.</p>
 */
@Component
public final class CollectionResultSafetyGate {
    private final SourceConnectorRegistry registry;
    private final CollectionResultValidator validator;
    private final RuntimeConnectorContractGuard contractGuard;

    public CollectionResultSafetyGate(
            SourceConnectorRegistry registry,
            CollectionResultValidator validator,
            RuntimeConnectorContractGuard contractGuard) {
        this.registry = Objects.requireNonNull(registry, "registry");
        this.validator = Objects.requireNonNull(validator, "validator");
        this.contractGuard = Objects.requireNonNull(contractGuard, "contractGuard");
    }

    public CollectionResult validate(
            String connectorCode,
            CollectionRequest request,
            CollectionResult result,
            Instant trustedFinishedAt) {
        Objects.requireNonNull(connectorCode, "connectorCode");
        Objects.requireNonNull(request, "request");
        Objects.requireNonNull(result, "result");
        Objects.requireNonNull(trustedFinishedAt, "trustedFinishedAt");

        var connector = registry.find(connectorCode).orElseThrow(() ->
                new IllegalStateException("COLLECTION_RESULT_CONNECTOR_NOT_REGISTERED"));
        var descriptor = connector.descriptor();
        if (!descriptor.streams().contains(request.stream())) {
            throw new IllegalStateException("COLLECTION_RESULT_STREAM_UNSUPPORTED");
        }

        var validated = validator.validate(
                request,
                descriptor,
                result,
                trustedFinishedAt);
        contractGuard.verify(descriptor, request.stream(), validated);
        return validated;
    }
}
