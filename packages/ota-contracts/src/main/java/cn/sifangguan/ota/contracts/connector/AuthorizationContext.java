package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.common.TraceContext;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record AuthorizationContext(
        TenantHotelRef scope,
        UUID connectorId,
        long configVersion,
        UUID authorizationAttemptId,
        Instant expiresAt,
        TraceContext traceContext) {
    public AuthorizationContext {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(connectorId, "connectorId");
        if (configVersion < 1) {
            throw new IllegalArgumentException("configVersion must be positive");
        }
        Objects.requireNonNull(authorizationAttemptId, "authorizationAttemptId");
        Objects.requireNonNull(expiresAt, "expiresAt");
        Objects.requireNonNull(traceContext, "traceContext");
    }
}
