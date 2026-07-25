package cn.sifangguan.ota.api.tenancy;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;

import java.time.Clock;
import java.util.UUID;
import java.util.regex.Pattern;

public final class PrivilegedTenantCommandExecutor {
    private static final Pattern SAFE_KEY = Pattern.compile("[A-Za-z0-9._:-]{8,200}");
    private static final Pattern SAFE_REASON = Pattern.compile("[A-Z][A-Z0-9_]{2,63}");
    private static final Pattern SHA_256 = Pattern.compile("[a-f0-9]{64}");
    private final TenantContextExecutor tenantContext;
    private final TenantConfigurationCommandHandler handler;
    private final HotelScopeAuthorizationPort hotelScopes;
    private final AuditPort audit;
    private final Clock clock;

    public PrivilegedTenantCommandExecutor(
            TenantContextExecutor tenantContext,
            TenantConfigurationCommandHandler handler,
            AuditPort audit,
            Clock clock
    ) {
        this(tenantContext, handler, (accountId, hotelId, scopeType) -> false, audit, clock);
    }

    public PrivilegedTenantCommandExecutor(
            TenantContextExecutor tenantContext,
            TenantConfigurationCommandHandler handler,
            HotelScopeAuthorizationPort hotelScopes,
            AuditPort audit,
            Clock clock
    ) {
        this.tenantContext = tenantContext;
        this.handler = handler;
        this.hotelScopes = hotelScopes;
        this.audit = audit;
        this.clock = clock;
    }

    public TenantConfigurationCommandHandler.CommandReceipt execute(
            TrustedAuthorizationContext authorization,
            TenantConfigurationCommand command,
            String correlationId
    ) {
        if (command == null) {
            audit(authorization, null, "DENIED", "INVALID_COMMAND_ENVELOPE", correlationId, false);
            throw new IllegalArgumentException("Tenant command is required");
        }
        if (command instanceof Sprint1TenantCommand sprint1
                && !authorization.accountId().equals(sprint1.actorAccountId())) {
            audit(authorization, command, "DENIED", "ACTOR_CONTEXT_MISMATCH", correlationId, false);
            throw new SecurityException("Command actor does not match the authenticated account");
        }
        boolean platformAdmin = authorization.roles().contains(OtaRole.PLATFORM_ADMIN)
                && authorization.has(command.requiredPermission());
        boolean scopedRevenueManager = isScopedRevenueManagerCommand(authorization, command);
        if (!platformAdmin && !scopedRevenueManager) {
            audit(authorization, command, "DENIED", "MISSING_EXPLICIT_CONFIG_PERMISSION", correlationId, false);
            throw new SecurityException("Explicit platform configuration permission is required");
        }
        try {
            validate(command);
        } catch (IllegalArgumentException exception) {
            audit(authorization, command, "DENIED", "INVALID_COMMAND_ENVELOPE", correlationId, false);
            throw exception;
        }
        try {
            TenantConfigurationCommandHandler.CommandReceipt receipt = tenantContext.inTenant(
                    command.targetTenantId(), false, () -> {
                        if (scopedRevenueManager
                                && !hotelScopes.hasActiveScope(
                                        authorization.accountId(),
                                        ((Sprint1TenantCommand) command).mutation().hotelId(),
                                        "REVENUE_CONFIGURATION")) {
                            throw new MissingHotelScopeException();
                        }
                        TenantConfigurationCommandHandler.CommandReceipt handled = handler.handle(command);
                        audit(authorization, command, "SUCCEEDED", null, correlationId, true);
                        return handled;
                    });
            return receipt;
        } catch (MissingHotelScopeException exception) {
            audit(authorization, command, "DENIED", "MISSING_HOTEL_SCOPE", correlationId, false);
            throw new SecurityException("Revenue configuration hotel scope is required");
        } catch (RuntimeException exception) {
            audit(authorization, command, "FAILED", "TENANT_COMMAND_FAILED", correlationId, false);
            throw exception;
        }
    }

    private static void validate(TenantConfigurationCommand command) {
        if (command.targetTenantId() == null
                || command.expectedRowVersion() < 0
                || !SAFE_KEY.matcher(command.idempotencyKey()).matches()
                || !SAFE_REASON.matcher(command.changeReasonCode()).matches()) {
            throw new IllegalArgumentException("Tenant command envelope is invalid");
        }
        if (command instanceof UpsertHotelConfigurationCommand hotel && hotel.hotelId() == null) {
            throw new IllegalArgumentException("Hotel target is required");
        }
        if (command instanceof UpsertConnectorReferenceCommand connector
                && (connector.hotelId() == null || connector.connectorId() == null)) {
            throw new IllegalArgumentException("Hotel and connector targets are required");
        }
        if (command instanceof Sprint1TenantCommand sprint1) {
            if (!SHA_256.matcher(sprint1.requestHash()).matches()) {
                throw new IllegalArgumentException("Sprint 1 request hash is invalid");
            }
            if (sprint1.actorAccountId() == null) {
                throw new IllegalArgumentException("Sprint 1 actor is required");
            }
            if (sprint1.mutation() instanceof
                    cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations.UpsertTenant tenant
                    && !tenant.tenantId().equals(sprint1.targetTenantId())) {
                throw new IllegalArgumentException("Tenant command target does not match its payload");
            }
        }
    }

    private static boolean isScopedRevenueManagerCommand(
            TrustedAuthorizationContext authorization,
            TenantConfigurationCommand command
    ) {
        if (!authorization.roles().contains(OtaRole.REVENUE_MANAGER)
                || !authorization.has(command.requiredPermission())
                || !(command instanceof Sprint1TenantCommand sprint1)
                || sprint1.mutation().hotelId() == null) {
            return false;
        }
        return switch (command.requiredPermission()) {
            case ROOM_MAPPING_MANAGE, REVENUE_TARGET_MANAGE, PACE_CURVE_MANAGE -> true;
            default -> false;
        };
    }

    private static final class MissingHotelScopeException extends RuntimeException {
    }

    private void audit(
            TrustedAuthorizationContext authorization,
            TenantConfigurationCommand command,
            String outcome,
            String reason,
            String correlationId,
            boolean inCurrentTransaction
    ) {
        String resourceType = command instanceof Sprint1TenantCommand sprint1
                ? sprint1.mutation().resourceType()
                : command instanceof UpsertConnectorReferenceCommand ? "CONNECTOR_CONFIG" : "HOTEL_CONFIG";
        UUID resourceId = command instanceof Sprint1TenantCommand sprint1
                ? sprint1.mutation().resourceId()
                : command instanceof UpsertConnectorReferenceCommand connector
                    ? connector.connectorId()
                    : command instanceof UpsertHotelConfigurationCommand hotel ? hotel.hotelId() : null;
        UUID hotelId = command instanceof Sprint1TenantCommand sprint1
                ? sprint1.mutation().hotelId()
                : command instanceof UpsertConnectorReferenceCommand connector
                    ? connector.hotelId()
                    : command instanceof UpsertHotelConfigurationCommand hotel ? hotel.hotelId() : null;
        boolean sprint1IndependentEvidence =
                command instanceof Sprint1TenantCommand && !inCurrentTransaction;
        UUID auditedTenantId = sprint1IndependentEvidence
                ? null : command == null ? null : command.targetTenantId();
        UUID auditedHotelId = sprint1IndependentEvidence ? null : hotelId;
        String conditionHash = command instanceof Sprint1TenantCommand sprint1
                ? sprint1.requestHash() : null;
        AuditEvent event = new AuditEvent(
                UUID.randomUUID(), "PRIVILEGED_TENANT_COMMAND", authorization.accountId(),
                outcome, reason, correlationId, clock.instant(), resourceType, resourceId,
                auditedTenantId, auditedHotelId, null, conditionHash);
        if (inCurrentTransaction) {
            audit.appendInCurrentTransaction(event);
        } else {
            audit.append(event);
        }
    }
}
