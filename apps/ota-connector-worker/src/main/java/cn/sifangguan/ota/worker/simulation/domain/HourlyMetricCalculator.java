package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.OptionalLong;

public final class HourlyMetricCalculator {
    private static final int INTERNAL_SCALE = 12;
    private static final BigDecimal PACE_TOLERANCE = new BigDecimal("0.020");
    private static final BigDecimal PRICE_LOW = new BigDecimal("0.90");
    private static final BigDecimal PRICE_HIGH = new BigDecimal("1.10");

    public HourlyMetrics calculate(
            LocalDate businessDate,
            Instant cutoffAt,
            Optional<PmsOperatingRecord> current,
            Optional<PmsOperatingRecord> previous,
            Optional<RevenuePaceConfig> config,
            OptionalLong previousConfigVersion,
            boolean pmsFresh) {
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(cutoffAt, "cutoffAt");
        current = Objects.requireNonNull(current, "current");
        previous = Objects.requireNonNull(previous, "previous");
        config = Objects.requireNonNull(config, "config");
        Objects.requireNonNull(previousConfigVersion, "previousConfigVersion");

        if (!pmsFresh || current.isEmpty()) {
            var unavailable = MetricValue.unavailable(
                    pmsFresh ? "PMS_OPERATING_MISSING" : "PMS_STALE");
            return new HourlyMetrics(
                    businessDate, cutoffAt, Optional.empty(), previous, false, true, List.of(),
                    unavailable, unavailable, unavailable, unavailable,
                    unavailable, unavailable, unavailable, unavailable,
                    unavailable, unavailable, unavailable, unavailable,
                    PaceStatus.UNAVAILABLE, PaceStatus.UNAVAILABLE, PriceStatus.UNAVAILABLE);
        }

        var currentValue = current.orElseThrow();
        var issues = consistencyIssues(currentValue);
        if (!issues.isEmpty()) {
            var invalid = MetricValue.consistencyError(String.join(",", issues));
            return new HourlyMetrics(
                    businessDate, cutoffAt, current, previous, false, false, issues,
                    invalid, invalid, invalid, invalid, invalid, invalid, invalid, invalid,
                    invalid, invalid, invalid, invalid,
                    PaceStatus.UNAVAILABLE, PaceStatus.UNAVAILABLE, PriceStatus.UNAVAILABLE);
        }

        var firstReport = previous.isEmpty()
                || !previous.orElseThrow().businessDate().equals(currentValue.businessDate());
        var configChanged = config.isPresent()
                && previousConfigVersion.isPresent()
                && previousConfigVersion.getAsLong() != config.orElseThrow().version();

        var totalRevenue = money(currentValue.totalRoomRevenue());
        var overnightRevenue = money(currentValue.totalRoomRevenue()
                .subtract(currentValue.hourlyRoomRevenue()));
        var effectiveTotal = currentValue.effectiveSellableTotal()
                .orElse(currentValue.overnightSold() + currentValue.currentAvailable());
        var adr = divide(overnightRevenue, currentValue.overnightSold(), "ZERO_DENOMINATOR");
        var revpar = divide(overnightRevenue, effectiveTotal, "ZERO_DENOMINATOR");
        var sellProgress = divide(
                BigDecimal.valueOf(currentValue.overnightSold()),
                effectiveTotal,
                "ZERO_DENOMINATOR");

        MetricValue targetProgress;
        MetricValue targetGap;
        MetricValue requiredRemainingAdr;
        MetricValue revenueDeviation;
        MetricValue sellDeviation;
        MetricValue hourlyTargetSpeed;
        MetricValue hourlySellSpeed;
        PaceStatus revenueStatus;
        PaceStatus sellStatus;
        PriceStatus priceStatus;

        if (config.isEmpty()) {
            var missing = MetricValue.notConfigured("TARGET_OR_PACE_NOT_CONFIGURED");
            targetProgress = missing;
            targetGap = missing;
            requiredRemainingAdr = missing;
            revenueDeviation = missing;
            sellDeviation = missing;
            hourlyTargetSpeed = firstReport
                    ? MetricValue.notApplicable("BUSINESS_DAY_FIRST_REPORT")
                    : missing;
            hourlySellSpeed = firstReport
                    ? MetricValue.notApplicable("BUSINESS_DAY_FIRST_REPORT")
                    : missing;
            revenueStatus = PaceStatus.UNAVAILABLE;
            sellStatus = PaceStatus.UNAVAILABLE;
            priceStatus = PriceStatus.UNAVAILABLE;
        } else {
            var activeConfig = config.orElseThrow();
            targetProgress = divide(
                    totalRevenue, activeConfig.dailyTarget(), "ZERO_DENOMINATOR");
            targetGap = MetricValue.available(money(activeConfig.dailyTarget()
                    .subtract(totalRevenue)
                    .max(BigDecimal.ZERO)));
            requiredRemainingAdr = currentValue.currentAvailable() == 0
                    ? MetricValue.notApplicable("ZERO_DENOMINATOR")
                    : MetricValue.available(divideRaw(
                            targetGap.requiredValue(),
                            BigDecimal.valueOf(currentValue.currentAvailable())));
            revenueDeviation = difference(
                    targetProgress,
                    MetricValue.available(activeConfig.revenuePaceStandard()));
            sellDeviation = difference(
                    sellProgress,
                    MetricValue.available(activeConfig.sellPaceStandard()));
            revenueStatus = paceStatus(revenueDeviation);
            sellStatus = paceStatus(sellDeviation);
            priceStatus = priceStatus(adr, activeConfig.targetAdr());

            if (firstReport) {
                hourlyTargetSpeed = MetricValue.notApplicable("BUSINESS_DAY_FIRST_REPORT");
                hourlySellSpeed = MetricValue.notApplicable("BUSINESS_DAY_FIRST_REPORT");
            } else if (configChanged) {
                hourlyTargetSpeed = MetricValue.notApplicable("CONFIG_VERSION_CHANGED");
                hourlySellSpeed = MetricValue.notApplicable("CONFIG_VERSION_CHANGED");
            } else if (previous.isEmpty() || !consistencyIssues(previous.orElseThrow()).isEmpty()) {
                hourlyTargetSpeed = MetricValue.unavailable("PREVIOUS_SNAPSHOT_UNAVAILABLE");
                hourlySellSpeed = MetricValue.unavailable("PREVIOUS_SNAPSHOT_UNAVAILABLE");
            } else {
                var previousValue = previous.orElseThrow();
                var previousEffectiveTotal = previousValue.effectiveSellableTotal()
                        .orElse(previousValue.overnightSold() + previousValue.currentAvailable());
                var previousTargetProgress = divide(
                        money(previousValue.totalRoomRevenue()),
                        activeConfig.dailyTarget(),
                        "ZERO_DENOMINATOR");
                var previousSellProgress = divide(
                        BigDecimal.valueOf(previousValue.overnightSold()),
                        previousEffectiveTotal,
                        "ZERO_DENOMINATOR");
                hourlyTargetSpeed = difference(targetProgress, previousTargetProgress);
                hourlySellSpeed = difference(sellProgress, previousSellProgress);
            }
        }

        return new HourlyMetrics(
                businessDate,
                cutoffAt,
                current,
                previous,
                firstReport,
                true,
                List.of(),
                MetricValue.available(totalRevenue),
                MetricValue.available(overnightRevenue),
                adr,
                revpar,
                targetProgress,
                targetGap,
                requiredRemainingAdr,
                sellProgress,
                revenueDeviation,
                sellDeviation,
                hourlyTargetSpeed,
                hourlySellSpeed,
                revenueStatus,
                sellStatus,
                priceStatus);
    }

    private static List<String> consistencyIssues(PmsOperatingRecord record) {
        var issues = new ArrayList<String>();
        if (record.totalRoomRevenue().signum() < 0) {
            issues.add("NEGATIVE_TOTAL_REVENUE");
        }
        if (record.hourlyRoomRevenue().signum() < 0) {
            issues.add("NEGATIVE_HOURLY_REVENUE");
        }
        if (record.hourlyRoomRevenue().compareTo(record.totalRoomRevenue()) > 0) {
            issues.add("HOURLY_REVENUE_EXCEEDS_TOTAL");
        }
        if (record.overnightSold() < 0) {
            issues.add("NEGATIVE_OVERNIGHT_SOLD");
        }
        if (record.currentAvailable() < 0) {
            issues.add("NEGATIVE_CURRENT_AVAILABLE");
        }
        var total = record.effectiveSellableTotal()
                .orElse(record.overnightSold() + record.currentAvailable());
        if (record.overnightSold() > total) {
            issues.add("SELL_PROGRESS_EXCEEDS_100_PERCENT");
        }
        return List.copyOf(issues);
    }

    private static BigDecimal money(BigDecimal value) {
        return value.setScale(4, RoundingMode.HALF_UP);
    }

    private static MetricValue divide(BigDecimal numerator, int denominator, String zeroReason) {
        if (denominator == 0) {
            return MetricValue.notApplicable(zeroReason);
        }
        return MetricValue.available(divideRaw(numerator, BigDecimal.valueOf(denominator)));
    }

    private static MetricValue divide(
            BigDecimal numerator, BigDecimal denominator, String zeroReason) {
        if (denominator.signum() == 0) {
            return MetricValue.notApplicable(zeroReason);
        }
        return MetricValue.available(divideRaw(numerator, denominator));
    }

    private static BigDecimal divideRaw(BigDecimal numerator, BigDecimal denominator) {
        return numerator.divide(denominator, INTERNAL_SCALE, RoundingMode.HALF_UP);
    }

    private static MetricValue difference(MetricValue left, MetricValue right) {
        if (left.state() != MetricState.AVAILABLE) {
            return left;
        }
        if (right.state() != MetricState.AVAILABLE) {
            return right;
        }
        return MetricValue.available(left.requiredValue().subtract(right.requiredValue()));
    }

    private static PaceStatus paceStatus(MetricValue deviation) {
        if (deviation.state() != MetricState.AVAILABLE) {
            return PaceStatus.UNAVAILABLE;
        }
        if (deviation.requiredValue().compareTo(PACE_TOLERANCE.negate()) < 0) {
            return PaceStatus.LAGGING;
        }
        if (deviation.requiredValue().compareTo(PACE_TOLERANCE) > 0) {
            return PaceStatus.AHEAD;
        }
        return PaceStatus.ON_PACE;
    }

    private static PriceStatus priceStatus(MetricValue adr, BigDecimal targetAdr) {
        if (adr.state() != MetricState.AVAILABLE || targetAdr.signum() == 0) {
            return PriceStatus.UNAVAILABLE;
        }
        var ratio = divideRaw(adr.requiredValue(), targetAdr);
        if (ratio.compareTo(PRICE_LOW) < 0) {
            return PriceStatus.LOW;
        }
        if (ratio.compareTo(PRICE_HIGH) > 0) {
            return PriceStatus.HIGH;
        }
        return PriceStatus.REASONABLE;
    }
}
