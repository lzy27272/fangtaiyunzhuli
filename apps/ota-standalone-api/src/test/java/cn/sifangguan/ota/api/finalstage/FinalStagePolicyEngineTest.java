package cn.sifangguan.ota.api.finalstage;

import cn.sifangguan.ota.api.auth.domain.OtaRole;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import static cn.sifangguan.ota.api.finalstage.FinalStageModels.*;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FinalStagePolicyEngineTest {
    private final FinalStagePolicyEngine policy = new FinalStagePolicyEngine();

    @Test
    void missingSourceIsUnavailableRatherThanZero() {
        assertThat(policy.freshness(new FreshnessInput(
                Instant.parse("2026-08-12T08:00:00Z"), null, 60)))
                .isEqualTo(DataState.UNAVAILABLE);
    }

    @Test
    void p2AlwaysCreatesImmediateInAppAndWeComIntentButNoExternalSend() {
        NotificationRoute route = policy.route(Severity.P2, AlertStage.FIRST_NOTICE);

        assertThat(route.routeCode()).isEqualTo("IN_APP_AND_WECOM");
        assertThat(route.inApp()).isTrue();
        assertThat(route.weCom()).isTrue();
        assertThat(route.immediate()).isTrue();
        assertThat(route.externalDeliveryAllowed()).isFalse();
    }

    @Test
    void p3CanOnlyUseDailySummary() {
        assertThat(policy.route(Severity.P3, AlertStage.DAILY_SUMMARY).immediate())
                .isFalse();
        assertThatThrownBy(() -> policy.route(Severity.P3, AlertStage.FIRST_NOTICE))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void modelOutageFallsBackWithoutChangingFormalFacts() {
        AiDecision decision = policy.advice(true, true, false);

        assertThat(decision.mode()).isEqualTo(AdviceMode.DETERMINISTIC_ONLY);
        assertThat(decision.formalFactsUnaffected()).isTrue();
        assertThat(decision.reasonCode()).isEqualTo("MODEL_GATEWAY_UNAVAILABLE");
    }

    @Test
    void priceWriteRemainsDisabledEvenAfterAllBusinessChecksPass() {
        assertThat(policy.priceGate(validPriceInput(false)))
                .isEqualTo(PriceDecision.EXTERNAL_EXECUTION_DISABLED);
    }

    @Test
    void priceApprovalRequiresDifferentOtaManagerAccount() {
        UUID same = UUID.randomUUID();
        PriceGateInput input = new PriceGateInput(
                same, OtaRole.GENERAL_MANAGER,
                same, OtaRole.OTA_OPERATION_MANAGER,
                "STANDARD_RETAIL", BigDecimal.valueOf(520),
                BigDecimal.valueOf(480), BigDecimal.valueOf(560),
                Instant.parse("2026-08-12T09:00:00Z"),
                Instant.parse("2026-08-12T08:00:00Z"),
                true, true, true, true, true, false);

        assertThat(policy.priceGate(input))
                .isEqualTo(PriceDecision.SAME_ACCOUNT_APPROVAL);
    }

    @Test
    void onlyStandardRetailAndRecommendedRangeCanProceed() {
        PriceGateInput base = validPriceInput(true);

        assertThat(policy.priceGate(copy(base, "MEMBER_RATE", BigDecimal.valueOf(520))))
                .isEqualTo(PriceDecision.UNSUPPORTED_RATE_TYPE);
        assertThat(policy.priceGate(copy(base, "STANDARD_RETAIL", BigDecimal.valueOf(700))))
                .isEqualTo(PriceDecision.OUTSIDE_RECOMMENDED_RANGE);
    }

    @Test
    void sevenCleanBusinessDaysPassPerHotelReleaseGate() {
        List<UatDay> evidence = cleanEvidence();

        UatDecision decision = policy.uatGate(evidence);

        assertThat(decision.readyForRelease()).isTrue();
        assertThat(decision.distinctEvidenceDays()).isEqualTo(7);
    }

    @Test
    void failedHotelStaysOnExistingServiceWithoutBlockingOthers() {
        List<UatDay> evidence = IntStream.range(0, 7)
                .mapToObj(day -> new UatDay(
                        LocalDate.of(2026, 8, 1).plusDays(day),
                        day == 4 ? BigDecimal.valueOf(98.9) : BigDecimal.valueOf(99.5),
                        true, true, 0, 0))
                .toList();

        UatDecision decision = policy.uatGate(evidence);

        assertThat(decision.readyForRelease()).isFalse();
        assertThat(decision.reasonCode()).isEqualTo("STORE_REMAINS_ON_EXISTING_SERVICE");
    }

    @Test
    void finalStageStatusExposesOneYearRetentionAndExternalBlockers() {
        CapabilityStatus status = policy.capabilityStatus();

        assertThat(status.operatingRetentionDays()).isEqualTo(365);
        assertThat(status.rawEvidenceRetentionDays()).isEqualTo(30);
        assertThat(status.p2WeComIntentEnabled()).isTrue();
        assertThat(status.externalModelCallsEnabled()).isFalse();
        assertThat(status.externalPriceWritesEnabled()).isFalse();
        assertThat(status.uatBusinessDays()).isEqualTo(7);
    }

    private static List<UatDay> cleanEvidence() {
        return IntStream.range(0, 7)
                .mapToObj(day -> new UatDay(
                        LocalDate.of(2026, 8, 1).plusDays(day),
                        BigDecimal.valueOf(99.5), true, true, 0, 0))
                .toList();
    }

    private static PriceGateInput validPriceInput(boolean executionEnabled) {
        return new PriceGateInput(
                UUID.randomUUID(), OtaRole.GENERAL_MANAGER,
                UUID.randomUUID(), OtaRole.OTA_OPERATION_MANAGER,
                "STANDARD_RETAIL", BigDecimal.valueOf(520),
                BigDecimal.valueOf(480), BigDecimal.valueOf(560),
                Instant.parse("2026-08-12T09:00:00Z"),
                Instant.parse("2026-08-12T08:00:00Z"),
                true, true, true, true, true, executionEnabled);
    }

    private static PriceGateInput copy(
            PriceGateInput source,
            String rateType,
            BigDecimal proposedPrice
    ) {
        return new PriceGateInput(
                source.requesterAccountId(), source.requesterRole(),
                source.approverAccountId(), source.approverRole(),
                rateType, proposedPrice,
                source.recommendedMin(), source.recommendedMax(),
                source.previewExpiresAt(), source.evaluatedAt(),
                source.formalWriteAuthorization(), source.writeUatPassed(),
                source.mappingVersionMatches(), source.policyVersionMatches(),
                source.connectorHealthy(), source.externalExecutionEnabled());
    }
}
