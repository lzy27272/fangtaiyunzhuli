package cn.sifangguan.ota.api.sprint2.intake;

import cn.sifangguan.ota.api.audit.AuditEvent;
import cn.sifangguan.ota.api.audit.AuditPort;
import cn.sifangguan.ota.api.auth.application.AccountView;
import cn.sifangguan.ota.api.auth.domain.OtaRole;
import cn.sifangguan.ota.api.authorization.OtaPermission;
import cn.sifangguan.ota.api.authorization.TrustedAuthorizationContext;
import cn.sifangguan.ota.api.tenancy.TenantContextExecutor;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.BlockedAction;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.CommandReceipt;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.ConnectorDraftView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.IntakeTemplate;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SaveDraftCommand;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

public final class ConnectorIntakeService {
    private static final Pattern IDEMPOTENCY_KEY =
            Pattern.compile("[A-Za-z0-9._:-]{8,200}");
    private static final Pattern REASON_CODE =
            Pattern.compile("[A-Z][A-Z0-9_]{2,63}");

    private final ConnectorIntakeTemplateDirectory templates;
    private final ConnectorIntakePort port;
    private final TenantContextExecutor tenants;
    private final AuditPort audit;
    private final Clock clock;

    public ConnectorIntakeService(
            ConnectorIntakeTemplateDirectory templates,
            ConnectorIntakePort port,
            TenantContextExecutor tenants,
            AuditPort audit,
            Clock clock
    ) {
        this.templates = Objects.requireNonNull(templates, "templates");
        this.port = Objects.requireNonNull(port, "port");
        this.tenants = Objects.requireNonNull(tenants, "tenants");
        this.audit = Objects.requireNonNull(audit, "audit");
        this.clock = Objects.requireNonNull(clock, "clock");
    }

    public List<IntakeTemplate> templates(AccountView account) {
        Objects.requireNonNull(account, "account");
        return templates.list();
    }

    public List<ConnectorDraftView> listDrafts(
            AccountView account,
            UUID tenantId,
            UUID hotelId
    ) {
        requireGlobalRead(account);
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        return tenants.inTenant(tenantId, true, () -> port.listDrafts(hotelId));
    }

    public CommandReceipt saveDraft(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey,
            String templateCode,
            SourceCode sourceCode,
            String vendorCode,
            String vendorName,
            String productName,
            String productVersion,
            String connectionMethod,
            String externalHotelCode,
            String accountAlias,
            String networkRouteCode,
            int pollIntervalMinutes,
            List<SecretBindingInput> secretBindings,
            String correlationId
    ) {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(sourceCode, "sourceCode");
        validateCommandEnvelope(expectedRowVersion, reasonCode, idempotencyKey);
        if (expectedRowVersion == 0) {
            templates.validate(
                    templateCode,
                    sourceCode,
                    vendorCode,
                    vendorName,
                    productName,
                    productVersion,
                    connectionMethod,
                    externalHotelCode,
                    accountAlias,
                    networkRouteCode,
                    pollIntervalMinutes,
                    secretBindings);
        } else {
            templates.validateUpdate(
                    templateCode,
                    sourceCode,
                    vendorCode,
                    vendorName,
                    productName,
                    productVersion,
                    connectionMethod,
                    externalHotelCode,
                    accountAlias,
                    networkRouteCode,
                    pollIntervalMinutes,
                    secretBindings);
        }
        String requestHash = draftRequestHash(
                tenantId,
                hotelId,
                connectorId,
                expectedRowVersion,
                reasonCode,
                templateCode,
                sourceCode,
                vendorCode,
                vendorName,
                productName,
                productVersion,
                connectionMethod,
                externalHotelCode,
                accountAlias,
                networkRouteCode,
                pollIntervalMinutes,
                secretBindings);
        requireManage(account, tenantId, hotelId, connectorId, requestHash, correlationId);
        SaveDraftCommand command = new SaveDraftCommand(
                tenantId,
                hotelId,
                connectorId,
                account.id(),
                sourceCode,
                templateCode,
                vendorCode,
                vendorName,
                productName,
                productVersion,
                connectionMethod,
                externalHotelCode,
                accountAlias,
                networkRouteCode,
                pollIntervalMinutes,
                secretBindings,
                expectedRowVersion,
                idempotencyKey,
                reasonCode,
                requestHash);
        try {
            return tenants.inTenant(tenantId, false, () -> {
                CommandReceipt receipt = port.saveDraft(command);
                audit.appendInCurrentTransaction(event(
                        account,
                        "SPRINT2_CONNECTOR_INTAKE",
                        "SUCCEEDED",
                        null,
                        correlationId,
                        tenantId,
                        hotelId,
                        connectorId,
                        requestHash));
                return receipt;
            });
        } catch (RuntimeException failure) {
            audit.append(event(
                    account,
                    "SPRINT2_CONNECTOR_INTAKE",
                    "FAILED",
                    "CONNECTOR_INTAKE_FAILED",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    requestHash));
            throw failure;
        }
    }

    public void rejectExternalAction(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            BlockedAction action,
            String correlationId
    ) {
        Objects.requireNonNull(account, "account");
        Objects.requireNonNull(tenantId, "tenantId");
        Objects.requireNonNull(hotelId, "hotelId");
        Objects.requireNonNull(connectorId, "connectorId");
        Objects.requireNonNull(action, "action");
        TrustedAuthorizationContext authorization =
                TrustedAuthorizationContext.fromAuthenticatedAccount(account);
        if (!account.roles().contains(OtaRole.PLATFORM_ADMIN)
                || !authorization.has(OtaPermission.CONNECTOR_CONFIG_MANAGE)) {
            audit.append(event(
                    account,
                    "SPRINT2_CONNECTOR_" + action.name(),
                    "DENIED",
                    "MISSING_EXPLICIT_CONFIG_PERMISSION",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    null));
            throw new SecurityException(
                    "Explicit connector configuration permission is required");
        }
        audit.append(event(
                account,
                "SPRINT2_CONNECTOR_" + action.name(),
                "DENIED",
                "SPRINT2_EXTERNAL_ACTION_BLOCKED",
                correlationId,
                tenantId,
                hotelId,
                connectorId,
                null));
        throw new Sprint2ExternalActionBlockedException();
    }

    private void requireManage(
            AccountView account,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash,
            String correlationId
    ) {
        TrustedAuthorizationContext authorization =
                TrustedAuthorizationContext.fromAuthenticatedAccount(account);
        if (!account.roles().contains(OtaRole.PLATFORM_ADMIN)
                || !authorization.has(OtaPermission.CONNECTOR_CONFIG_MANAGE)) {
            audit.append(event(
                    account,
                    "SPRINT2_CONNECTOR_INTAKE",
                    "DENIED",
                    "MISSING_EXPLICIT_CONFIG_PERMISSION",
                    correlationId,
                    tenantId,
                    hotelId,
                    connectorId,
                    requestHash));
            throw new SecurityException(
                    "Explicit connector configuration permission is required");
        }
    }

    private static void requireGlobalRead(AccountView account) {
        Objects.requireNonNull(account, "account");
        if (account.roles().stream().noneMatch(OtaRole::hasGlobalReadAccess)) {
            throw new SecurityException("Global OTA read access is required");
        }
    }

    private static void validateCommandEnvelope(
            long expectedRowVersion,
            String reasonCode,
            String idempotencyKey
    ) {
        if (expectedRowVersion < 0
                || reasonCode == null
                || !REASON_CODE.matcher(reasonCode).matches()
                || idempotencyKey == null
                || !IDEMPOTENCY_KEY.matcher(idempotencyKey).matches()) {
            throw new IllegalArgumentException(
                    "Connector intake command envelope is invalid");
        }
    }

    private AuditEvent event(
            AccountView account,
            String eventType,
            String outcome,
            String reason,
            String correlationId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            String requestHash
    ) {
        return new AuditEvent(
                UUID.randomUUID(),
                eventType,
                account.id(),
                outcome,
                reason,
                correlationId,
                clock.instant(),
                "CONNECTOR_INTAKE",
                connectorId,
                tenantId,
                hotelId,
                null,
                requestHash);
    }

    private static String draftRequestHash(
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            long expectedRowVersion,
            String reasonCode,
            String templateCode,
            SourceCode sourceCode,
            String vendorCode,
            String vendorName,
            String productName,
            String productVersion,
            String connectionMethod,
            String externalHotelCode,
            String accountAlias,
            String networkRouteCode,
            int pollIntervalMinutes,
            List<SecretBindingInput> bindings
    ) {
        String bindingHashes = bindings.stream()
                .sorted(Comparator.comparing(SecretBindingInput::purpose))
                .map(binding -> String.join(
                        ":",
                        binding.purpose(),
                        binding.providerCode(),
                        binding.secretVersion(),
                        sha256(binding.opaqueSecretReference())))
                .reduce((left, right) -> left + "," + right)
                .orElse("");
        return sha256(String.join(
                "\n",
                tenantId.toString(),
                hotelId.toString(),
                connectorId.toString(),
                Long.toString(expectedRowVersion),
                reasonCode,
                templateCode,
                sourceCode.name(),
                vendorCode,
                vendorName,
                productName,
                nullToEmpty(productVersion),
                connectionMethod,
                externalHotelCode,
                nullToEmpty(accountAlias),
                networkRouteCode,
                Integer.toString(pollIntervalMinutes),
                bindingHashes));
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
