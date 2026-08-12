package cn.sifangguan.ota.api.finalstage;

import cn.sifangguan.ota.api.auth.domain.OtaRole;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.List;
import java.util.Objects;

import static cn.sifangguan.ota.api.finalstage.FinalStageModels.*;

public final class FinalStagePolicyEngine {
    public static final int OPERATING_RETENTION_DAYS = 365;
    public static final int RAW_EVIDENCE_RETENTION_DAYS = 30;
    public static final int UAT_BUSINESS_DAYS = 7;

    public DataState freshness(FreshnessInput input) {
        Objects.requireNonNull(input, "input");
        if (input.lastSuccessAt() == null) {
            return DataState.UNAVAILABLE;
        }
        Duration age = Duration.between(input.lastSuccessAt(), input.cutoffAt());
        if (age.isNegative()) {
            return DataState.SUSPECT;
        }
        return age.compareTo(Duration.ofMinutes(input.staleAfterMinutes())) <= 0
                ? DataState.FRESH : DataState.SUSPECT;
    }

    public NotificationRoute route(Severity severity, AlertStage stage) {
        Objects.requireNonNull(severity, "severity");
        Objects.requireNonNull(stage, "stage");
        if (severity == Severity.P3) {
            if (stage != AlertStage.DAILY_SUMMARY) {
                throw new IllegalArgumentException("P3 is emitted only in the daily summary");
            }
            return new NotificationRoute(
                    "DAILY_WECOM_SUMMARY", stage.name(), false, true, false, false);
        }
        if (stage == AlertStage.DAILY_SUMMARY) {
            throw new IllegalArgumentException("P1/P2 require immediate or SLA routing");
        }
        return new NotificationRoute(
                "IN_APP_AND_WECOM", stage.name(), true, true, true, false);
    }

    public AiDecision advice(
            boolean hotelScenarioEnabled,
            boolean structuredFactsComplete,
            boolean modelGatewayAvailable
    ) {
        if (hotelScenarioEnabled && structuredFactsComplete && modelGatewayAvailable) {
            return new AiDecision(
                    AdviceMode.MODEL_WITH_DETERMINISTIC_FALLBACK,
                    true,
                    "MODEL_ADVISORY_WITH_RULE_FALLBACK");
        }
        String reason = !hotelScenarioEnabled
                ? "HOTEL_SCENARIO_DISABLED"
                : !structuredFactsComplete
                ? "STRUCTURED_FACTS_INCOMPLETE"
                : "MODEL_GATEWAY_UNAVAILABLE";
        return new AiDecision(AdviceMode.DETERMINISTIC_ONLY, true, reason);
    }

    public PriceDecision priceGate(PriceGateInput input) {
        Objects.requireNonNull(input, "input");
        if (!"STANDARD_RETAIL".equals(input.rateType())) {
            return PriceDecision.UNSUPPORTED_RATE_TYPE;
        }
        if (input.previewExpiresAt().isBefore(input.evaluatedAt())) {
            return PriceDecision.PREVIEW_EXPIRED;
        }
        if (input.proposedPrice().compareTo(input.recommendedMin()) < 0
                || input.proposedPrice().compareTo(input.recommendedMax()) > 0) {
            return PriceDecision.OUTSIDE_RECOMMENDED_RANGE;
        }
        if (!input.requesterRole().mayInitiatePriceRequest()) {
            return PriceDecision.REQUESTER_NOT_AUTHORIZED;
        }
        if (input.requesterAccountId().equals(input.approverAccountId())) {
            return PriceDecision.SAME_ACCOUNT_APPROVAL;
        }
        if (input.approverRole() != OtaRole.OTA_OPERATION_MANAGER) {
            return PriceDecision.APPROVER_NOT_OTA_OPERATION_MANAGER;
        }
        if (!input.formalWriteAuthorization()) {
            return PriceDecision.AUTHORIZATION_MISSING;
        }
        if (!input.writeUatPassed()) {
            return PriceDecision.WRITE_UAT_MISSING;
        }
        if (!input.mappingVersionMatches() || !input.policyVersionMatches()
                || !input.connectorHealthy()) {
            return PriceDecision.PREFLIGHT_VERSION_MISMATCH;
        }
        if (!input.externalExecutionEnabled()) {
            return PriceDecision.EXTERNAL_EXECUTION_DISABLED;
        }
        return PriceDecision.ELIGIBLE_FOR_CONTROLLED_ADAPTER;
    }

    public UatDecision uatGate(List<UatDay> evidence) {
        Objects.requireNonNull(evidence, "evidence");
        int distinctDays = (int) evidence.stream()
                .map(UatDay::businessDate)
                .distinct()
                .count();
        if (distinctDays != UAT_BUSINESS_DAYS || evidence.size() != UAT_BUSINESS_DAYS) {
            return new UatDecision(false, Math.min(distinctDays, UAT_BUSINESS_DAYS),
                    "SEVEN_DISTINCT_BUSINESS_DAYS_REQUIRED");
        }
        boolean passed = evidence.stream().allMatch(day ->
                day.scheduledSuccessPercent().compareTo(BigDecimal.valueOf(99)) >= 0
                        && day.criticalWindowComplete()
                        && day.goldenSamplePassed()
                        && day.duplicateDeliveries() == 0
                        && day.piiFindings() == 0);
        return new UatDecision(
                passed,
                distinctDays,
                passed ? "ALL_STORE_UAT_GATE_PASSED" : "STORE_REMAINS_ON_EXISTING_SERVICE");
    }

    public CapabilityStatus capabilityStatus() {
        return new CapabilityStatus(
                OPERATING_RETENTION_DAYS,
                RAW_EVIDENCE_RETENTION_DAYS,
                true,
                true,
                false,
                false,
                UAT_BUSINESS_DAYS,
                List.of(
                        "FORMAL_VENDOR_AUTHORIZATION",
                        "CONTROLLED_SECRETSTORE_INTAKE",
                        "WECOM_UAT_SCOPE",
                        "SEVEN_DAY_ALL_STORE_EVIDENCE",
                        "WRITE_UAT_FOR_AUTHORIZED_CHANNEL"));
    }
}
