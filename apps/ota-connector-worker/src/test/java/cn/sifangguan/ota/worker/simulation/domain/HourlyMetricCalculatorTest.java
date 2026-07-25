package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Optional;
import java.util.OptionalLong;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class HourlyMetricCalculatorTest {
    private static final LocalDate DAY = LocalDate.of(2026, 7, 19);
    private static final Instant CUTOFF = Instant.parse("2026-07-19T10:00:00Z");
    private static final RevenuePaceConfig CONFIG = new RevenuePaceConfig(
            7,
            new BigDecimal("10000"),
            new BigDecimal("200"),
            new BigDecimal("0.882"),
            new BigDecimal("0.882"));

    private final HourlyMetricCalculator calculator = new HourlyMetricCalculator();

    @Test
    void calculatesFromUnroundedDecimalsAndLeavesHalfUpForPresentation() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "7849", "50", 39, 11, 50)),
                Optional.of(operating(
                        DAY, CUTOFF.minusSeconds(3600), "7683", "50", 38, 12, 50)),
                Optional.of(CONFIG),
                OptionalLong.of(7),
                true);

        assertEquals(new BigDecimal("7799.0000"), metrics.overnightRevenue().requiredValue());
        assertEquals(new BigDecimal("199.974358974359"), metrics.adr().requiredValue());
        assertEquals(new BigDecimal("0.784900000000"),
                metrics.targetProgress().requiredValue());
        assertEquals(PaceStatus.LAGGING, metrics.revenuePaceStatus());
        assertEquals(PriceStatus.REASONABLE, metrics.priceStatus());
        assertTrue(metrics.consistencyValid());
    }

    @Test
    void zeroDenominatorsAreNotApplicableRatherThanZero() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "0", "0", 0, 0, 0)),
                Optional.empty(),
                Optional.of(new RevenuePaceConfig(
                        1, BigDecimal.ZERO, BigDecimal.ZERO,
                        BigDecimal.ZERO, BigDecimal.ZERO)),
                OptionalLong.empty(),
                true);

        assertEquals(MetricState.NOT_APPLICABLE, metrics.adr().state());
        assertEquals("ZERO_DENOMINATOR", metrics.adr().reason());
        assertEquals(MetricState.NOT_APPLICABLE, metrics.targetProgress().state());
        assertEquals(MetricState.NOT_APPLICABLE, metrics.requiredRemainingAdr().state());
        assertFalse(metrics.adr().value().isPresent());
    }

    @Test
    void missingConfigurationIsNotReportedAsZero() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "200", "0", 1, 1, 2)),
                Optional.empty(),
                Optional.empty(),
                OptionalLong.empty(),
                true);

        assertEquals(MetricState.NOT_CONFIGURED, metrics.targetProgress().state());
        assertEquals(MetricState.NOT_CONFIGURED, metrics.revenuePaceDeviation().state());
    }

    @Test
    void firstReportNeverComparesAcrossPmsBusinessDays() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "200", "0", 1, 1, 2)),
                Optional.of(operating(
                        DAY.minusDays(1), CUTOFF.minusSeconds(3600), "9999", "0", 1, 1, 2)),
                Optional.of(CONFIG),
                OptionalLong.of(7),
                true);

        assertTrue(metrics.businessDayFirstReport());
        assertEquals(MetricState.NOT_APPLICABLE, metrics.hourlyTargetSpeed().state());
        assertEquals("BUSINESS_DAY_FIRST_REPORT", metrics.hourlyTargetSpeed().reason());
        assertEquals(MetricState.NOT_APPLICABLE, metrics.hourlySellSpeed().state());
    }

    @Test
    void stalePmsFailsClosedWithoutReusingValues() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "7849", "50", 39, 11, 50)),
                Optional.empty(),
                Optional.of(CONFIG),
                OptionalLong.empty(),
                false);

        assertEquals(MetricState.UNAVAILABLE, metrics.totalRevenue().state());
        assertEquals("PMS_STALE", metrics.totalRevenue().reason());
        assertTrue(metrics.current().isEmpty());
    }

    @Test
    void abnormalOccupancyIsFlaggedAndNotClamped() {
        var metrics = calculator.calculate(
                DAY,
                CUTOFF,
                Optional.of(operating(DAY, CUTOFF, "100", "0", 3, 0, 2)),
                Optional.empty(),
                Optional.of(CONFIG),
                OptionalLong.empty(),
                true);

        assertFalse(metrics.consistencyValid());
        assertTrue(metrics.consistencyIssues().contains(
                "SELL_PROGRESS_EXCEEDS_100_PERCENT"));
        assertEquals(MetricState.CONSISTENCY_ERROR, metrics.sellProgress().state());
    }

    private static PmsOperatingRecord operating(
            LocalDate day,
            Instant at,
            String total,
            String hourly,
            int sold,
            int available,
            int effectiveTotal) {
        return new PmsOperatingRecord(
                "operating-" + at,
                day,
                at,
                new BigDecimal(total),
                new BigDecimal(hourly),
                sold,
                available,
                Optional.of(effectiveTotal),
                at);
    }
}
