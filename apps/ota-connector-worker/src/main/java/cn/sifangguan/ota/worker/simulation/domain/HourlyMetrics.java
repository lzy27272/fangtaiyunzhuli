package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.record.PmsOperatingRecord;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

public record HourlyMetrics(
        LocalDate businessDate,
        Instant cutoffAt,
        Optional<PmsOperatingRecord> current,
        Optional<PmsOperatingRecord> previous,
        boolean businessDayFirstReport,
        boolean consistencyValid,
        List<String> consistencyIssues,
        MetricValue totalRevenue,
        MetricValue overnightRevenue,
        MetricValue adr,
        MetricValue revpar,
        MetricValue targetProgress,
        MetricValue targetGap,
        MetricValue requiredRemainingAdr,
        MetricValue sellProgress,
        MetricValue revenuePaceDeviation,
        MetricValue sellPaceDeviation,
        MetricValue hourlyTargetSpeed,
        MetricValue hourlySellSpeed,
        PaceStatus revenuePaceStatus,
        PaceStatus sellPaceStatus,
        PriceStatus priceStatus) {

    public HourlyMetrics {
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(cutoffAt, "cutoffAt");
        current = Objects.requireNonNull(current, "current");
        previous = Objects.requireNonNull(previous, "previous");
        consistencyIssues = List.copyOf(
                Objects.requireNonNull(consistencyIssues, "consistencyIssues"));
        Objects.requireNonNull(totalRevenue, "totalRevenue");
        Objects.requireNonNull(overnightRevenue, "overnightRevenue");
        Objects.requireNonNull(adr, "adr");
        Objects.requireNonNull(revpar, "revpar");
        Objects.requireNonNull(targetProgress, "targetProgress");
        Objects.requireNonNull(targetGap, "targetGap");
        Objects.requireNonNull(requiredRemainingAdr, "requiredRemainingAdr");
        Objects.requireNonNull(sellProgress, "sellProgress");
        Objects.requireNonNull(revenuePaceDeviation, "revenuePaceDeviation");
        Objects.requireNonNull(sellPaceDeviation, "sellPaceDeviation");
        Objects.requireNonNull(hourlyTargetSpeed, "hourlyTargetSpeed");
        Objects.requireNonNull(hourlySellSpeed, "hourlySellSpeed");
        Objects.requireNonNull(revenuePaceStatus, "revenuePaceStatus");
        Objects.requireNonNull(sellPaceStatus, "sellPaceStatus");
        Objects.requireNonNull(priceStatus, "priceStatus");
    }
}
