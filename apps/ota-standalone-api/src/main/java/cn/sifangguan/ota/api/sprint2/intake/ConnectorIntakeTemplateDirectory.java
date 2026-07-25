package cn.sifangguan.ota.api.sprint2.intake;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.IntakeTemplate;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SecretBindingInput;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

/**
 * Server-owned real-integration preparation catalog. These records describe
 * intake only; none represents an executable connector.
 */
public final class ConnectorIntakeTemplateDirectory {
    public static final List<String> ACCEPTED_FIELDS = List.of(
            "expectedRowVersion",
            "reasonCode",
            "templateCode",
            "sourceCode",
            "vendorCode",
            "vendorName",
            "productName",
            "productVersion",
            "connectionMethod",
            "externalHotelCode",
            "accountAlias",
            "networkRouteCode",
            "pollIntervalMinutes",
            "secretBindings");

    private static final Pattern SAFE_CODE =
            Pattern.compile("[A-Za-z0-9][A-Za-z0-9._:@/+ -]{0,159}");
    private static final Pattern PURPOSE = Pattern.compile("[A-Z][A-Z0-9_]{2,63}");
    private static final Pattern PROVIDER = Pattern.compile("[A-Z][A-Z0-9_]{1,47}");
    private static final Pattern SECRET_REFERENCE = Pattern.compile(
            "(?:kms|vault|secretstore|oskeyring|envref)://"
                    + "[A-Za-z0-9][A-Za-z0-9._/+~-]{2,500}");
    private static final Map<String, String> PROVIDER_SCHEMES = Map.of(
            "KMS", "kms",
            "VAULT", "vault",
            "SECRETSTORE", "secretstore",
            "OSKEYRING", "oskeyring",
            "ENVREF", "envref");
    private static final Set<String> FORBIDDEN_TEXT_FRAGMENTS = Set.of(
            "password=", "passphrase=", "token=", "cookie=", "authorization:",
            "bearer ", "privatekey=", "connectionstring=", "jdbc:",
            "http://", "https://", "file://", "<script", "select ", "insert ",
            "update ", "delete ");

    private final List<IntakeTemplate> templates;
    private final Map<String, IntakeTemplate> byCode;

    public ConnectorIntakeTemplateDirectory() {
        templates = List.of(
                template(
                        "PMS_INTAKE",
                        SourceCode.PMS,
                        "PMS真实接入准备",
                        List.of(
                                "OFFICIAL_API",
                                "READ_ONLY_DATABASE",
                                "AUTOMATED_REPORT",
                                "LOCAL_AGENT",
                                "CONTROLLED_BROWSER"),
                        List.of(5)),
                template(
                        "CTRIP_INTAKE",
                        SourceCode.CTRIP,
                        "携程真实接入准备",
                        List.of(
                                "OFFICIAL_API",
                                "AUTOMATED_REPORT",
                                "CONTROLLED_BROWSER"),
                        List.of(15, 30)),
                template(
                        "MEITUAN_INTAKE",
                        SourceCode.MEITUAN,
                        "美团真实接入准备",
                        List.of(
                                "OFFICIAL_API",
                                "AUTOMATED_REPORT",
                                "CONTROLLED_BROWSER"),
                        List.of(15, 30)));
        Map<String, IntakeTemplate> index = new LinkedHashMap<>();
        for (IntakeTemplate template : templates) {
            if (index.put(template.templateCode(), template) != null) {
                throw new IllegalStateException("Duplicate connector intake template");
            }
        }
        byCode = Map.copyOf(index);
    }

    public List<IntakeTemplate> list() {
        return templates;
    }

    public IntakeTemplate validate(
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
            List<SecretBindingInput> secretBindings
    ) {
        return validate(
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
                secretBindings,
                true);
    }

    public IntakeTemplate validateUpdate(
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
            List<SecretBindingInput> secretBindings
    ) {
        return validate(
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
                secretBindings,
                false);
    }

    private IntakeTemplate validate(
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
            boolean requireBindings
    ) {
        IntakeTemplate template = byCode.get(templateCode);
        if (template == null || template.sourceCode() != sourceCode) {
            throw new IllegalArgumentException(
                    "Template does not match the requested source");
        }
        if (!template.connectionMethods().contains(connectionMethod)) {
            throw new IllegalArgumentException(
                    "Connection method is not allowed by the server template");
        }
        if (!template.allowedPollIntervalsMinutes().contains(pollIntervalMinutes)) {
            throw new IllegalArgumentException(
                    "Poll interval is not allowed by the server template");
        }
        requireSafeText(vendorCode, "vendorCode", 64, true, true);
        requireSafeText(vendorName, "vendorName", 160, true, false);
        requireSafeText(productName, "productName", 160, true, false);
        requireSafeText(productVersion, "productVersion", 80, false, false);
        requireSafeText(externalHotelCode, "externalHotelCode", 160, true, true);
        requireSafeText(accountAlias, "accountAlias", 160, false, false);
        requireSafeText(networkRouteCode, "networkRouteCode", 96, true, true);
        validateSecretBindings(
                sourceCode,
                connectionMethod,
                secretBindings,
                requireBindings);
        return template;
    }

    private static void validateSecretBindings(
            SourceCode sourceCode,
            String connectionMethod,
            List<SecretBindingInput> bindings,
            boolean requireBindings
    ) {
        if (bindings == null) {
            throw new IllegalArgumentException("secretBindings is required");
        }
        if (!requireBindings && bindings.isEmpty()) {
            return;
        }
        Set<String> allowedPurposes = allowedPurposes(sourceCode, connectionMethod);
        Set<String> seen = new java.util.HashSet<>();
        for (SecretBindingInput binding : bindings) {
            if (!PURPOSE.matcher(binding.purpose()).matches()
                    || !allowedPurposes.contains(binding.purpose())
                    || !seen.add(binding.purpose())) {
                throw new IllegalArgumentException(
                        "Secret purpose is not allowed or is duplicated");
            }
            if (!PROVIDER.matcher(binding.providerCode()).matches()) {
                throw new IllegalArgumentException("Secret provider code is invalid");
            }
            if ("******".equals(binding.opaqueSecretReference())
                    || !SECRET_REFERENCE.matcher(
                            binding.opaqueSecretReference()).matches()) {
                throw new IllegalArgumentException(
                        "Only a controlled opaque SecretStore reference is allowed");
            }
            String expectedScheme = PROVIDER_SCHEMES.get(binding.providerCode());
            String actualScheme = binding.opaqueSecretReference().substring(
                    0,
                    binding.opaqueSecretReference().indexOf("://"));
            if (expectedScheme == null || !expectedScheme.equals(actualScheme)) {
                throw new IllegalArgumentException(
                        "Secret provider code does not match the reference scheme");
            }
            if ("BROWSER_SESSION".equals(binding.purpose())
                    && !(binding.opaqueSecretReference().startsWith("vault://")
                    || binding.opaqueSecretReference().startsWith("oskeyring://")
                    || binding.opaqueSecretReference().startsWith("secretstore://"))) {
                throw new IllegalArgumentException(
                        "Browser sessions require a dedicated opaque SecretStore reference");
            }
            requireSafeText(binding.secretVersion(), "secretVersion", 96, true, true);
        }
        if (!seen.equals(allowedPurposes)) {
            throw new IllegalArgumentException(
                    "All required secret purposes must be configured exactly once");
        }
    }

    public static List<String> requiredPurposes(
            SourceCode sourceCode,
            String connectionMethod
    ) {
        return allowedPurposes(sourceCode, connectionMethod).stream()
                .sorted()
                .toList();
    }

    private static Set<String> allowedPurposes(
            SourceCode sourceCode,
            String connectionMethod
    ) {
        if (sourceCode == SourceCode.PMS) {
            return switch (connectionMethod) {
                case "OFFICIAL_API", "AUTOMATED_REPORT" -> Set.of("SOURCE_AUTH");
                case "READ_ONLY_DATABASE" -> Set.of("PMS_READ_ONLY_CREDENTIAL");
                case "LOCAL_AGENT" -> Set.of(
                        "AGENT_MTLS_IDENTITY",
                        "PMS_READ_ONLY_CREDENTIAL");
                case "CONTROLLED_BROWSER" -> Set.of("BROWSER_SESSION");
                default -> Set.of();
            };
        }
        return switch (connectionMethod) {
            case "OFFICIAL_API", "AUTOMATED_REPORT" -> Set.of("SOURCE_AUTH");
            case "CONTROLLED_BROWSER" -> Set.of("BROWSER_SESSION");
            default -> Set.of();
        };
    }

    private static void requireSafeText(
            String value,
            String field,
            int maxLength,
            boolean required,
            boolean code
    ) {
        if (value == null || value.isBlank()) {
            if (required) {
                throw new IllegalArgumentException(field + " is required");
            }
            return;
        }
        if (value.length() > maxLength
                || value.chars().anyMatch(Character::isISOControl)
                || FORBIDDEN_TEXT_FRAGMENTS.stream().anyMatch(
                        fragment -> value.toLowerCase(Locale.ROOT).contains(fragment))
                || (code && !SAFE_CODE.matcher(value).matches())) {
            throw new IllegalArgumentException(field + " is invalid");
        }
    }

    private static IntakeTemplate template(
            String code,
            SourceCode sourceCode,
            String displayName,
            List<String> methods,
            List<Integer> intervals
    ) {
        return new IntakeTemplate(
                code,
                sourceCode,
                displayName,
                "DRAFT_INTAKE_ONLY",
                methods,
                intervals,
                ACCEPTED_FIELDS,
                false);
    }
}
