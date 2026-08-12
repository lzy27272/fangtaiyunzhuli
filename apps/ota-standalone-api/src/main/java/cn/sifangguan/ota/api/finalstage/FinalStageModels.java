package cn.sifangguan.ota.api.finalstage;

import cn.sifangguan.ota.api.auth.domain.OtaRole;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class FinalStageModels {
    private FinalStageModels() {
    }

    public enum Severity { P1, P2, P3 }

    public enum DataState { FRESH, SUSPECT, UNAVAILABLE }

    public enum AlertStage { FIRST_NOTICE, SLA_ESCALATION, DAILY_SUMMARY }

    public enum AdviceMode { MODEL_WITH_DETERMINISTIC_FALLBACK, DETERMINISTIC_ONLY }

    public enum PriceDecision {
        ELIGIBLE_FOR_CONTROLLED_ADAPTER,
        PREVIEW_EXPIRED,
        UNSUPPORTED_RATE_TYPE,
        OUTSIDE_RECOMMENDED_RANGE,
        REQUESTER_NOT_AUTHORIZED,
        SAME_ACCOUNT_APPROVAL,
        APPROVER_NOT_OTA_OPERATION_MANAGER,
        AUTHORIZATION_MISSING,
        WRITE_UAT_MISSING,
        PREFLIGHT_VERSION_MISMATCH,
        EXTERNAL_EXECUTION_DISABLED
    }

    public record FreshnessInput(
            Instant cutoffAt,
            Instant lastSuccessAt,
            int staleAfterMinutes
    ) {
        public FreshnessInput {
            Objects.requireNonNull(cutoffAt, "cutoffAt");
            if (staleAfterMinutes < 1 || staleAfterMinutes > 1440) {
                throw new IllegalArgumentException("staleAfterMinutes must be 1..1440");
            }
        }
    }

    public record NotificationRoute(
            String routeCode,
            String stageCode,
            boolean inApp,
            boolean weCom,
            boolean immediate,
            boolean externalDeliveryAllowed
    ) {
        public NotificationRoute {
            requireText(routeCode, "routeCode");
            requireText(stageCode, "stageCode");
            if (externalDeliveryAllowed) {
                throw new IllegalArgumentException("UAT route cannot allow external delivery");
            }
        }
    }

    public record AiDecision(
            AdviceMode mode,
            boolean formalFactsUnaffected,
            String reasonCode
    ) {
        public AiDecision {
            Objects.requireNonNull(mode, "mode");
            requireText(reasonCode, "reasonCode");
            if (!formalFactsUnaffected) {
                throw new IllegalArgumentException("AI may not control formal facts");
            }
        }
    }

    public record PriceGateInput(
            UUID requesterAccountId,
            OtaRole requesterRole,
            UUID approverAccountId,
            OtaRole approverRole,
            String rateType,
            BigDecimal proposedPrice,
            BigDecimal recommendedMin,
            BigDecimal recommendedMax,
            Instant previewExpiresAt,
            Instant evaluatedAt,
            boolean formalWriteAuthorization,
            boolean writeUatPassed,
            boolean mappingVersionMatches,
            boolean policyVersionMatches,
            boolean connectorHealthy,
            boolean externalExecutionEnabled
    ) {
        public PriceGateInput {
            Objects.requireNonNull(requesterAccountId, "requesterAccountId");
            Objects.requireNonNull(requesterRole, "requesterRole");
            Objects.requireNonNull(approverAccountId, "approverAccountId");
            Objects.requireNonNull(approverRole, "approverRole");
            requireText(rateType, "rateType");
            Objects.requireNonNull(proposedPrice, "proposedPrice");
            Objects.requireNonNull(recommendedMin, "recommendedMin");
            Objects.requireNonNull(recommendedMax, "recommendedMax");
            Objects.requireNonNull(previewExpiresAt, "previewExpiresAt");
            Objects.requireNonNull(evaluatedAt, "evaluatedAt");
            if (proposedPrice.signum() < 0 || recommendedMin.signum() < 0
                    || recommendedMax.compareTo(recommendedMin) < 0) {
                throw new IllegalArgumentException("invalid price range");
            }
        }
    }

    public record UatDay(
            LocalDate businessDate,
            BigDecimal scheduledSuccessPercent,
            boolean criticalWindowComplete,
            boolean goldenSamplePassed,
            int duplicateDeliveries,
            int piiFindings
    ) {
        public UatDay {
            Objects.requireNonNull(businessDate, "businessDate");
            Objects.requireNonNull(scheduledSuccessPercent, "scheduledSuccessPercent");
            if (scheduledSuccessPercent.signum() < 0
                    || scheduledSuccessPercent.compareTo(BigDecimal.valueOf(100)) > 0
                    || duplicateDeliveries < 0 || piiFindings < 0) {
                throw new IllegalArgumentException("invalid UAT evidence");
            }
        }
    }

    public record UatDecision(
            boolean readyForRelease,
            int distinctEvidenceDays,
            String reasonCode
    ) {
        public UatDecision {
            requireText(reasonCode, "reasonCode");
            if (distinctEvidenceDays < 0 || distinctEvidenceDays > 7) {
                throw new IllegalArgumentException("distinctEvidenceDays must be 0..7");
            }
        }
    }

    public record CapabilityStatus(
            int operatingRetentionDays,
            int rawEvidenceRetentionDays,
            boolean p2WeComIntentEnabled,
            boolean modelFallbackRequired,
            boolean externalModelCallsEnabled,
            boolean externalPriceWritesEnabled,
            int uatBusinessDays,
            List<String> blockedByExternalEvidence
    ) {
        public CapabilityStatus {
            blockedByExternalEvidence = List.copyOf(blockedByExternalEvidence);
        }
    }

    private static void requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }
}
