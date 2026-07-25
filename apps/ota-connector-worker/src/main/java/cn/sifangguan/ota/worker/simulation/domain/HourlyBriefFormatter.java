package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.contracts.quality.CompletenessState;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

public final class HourlyBriefFormatter {
    private static final DateTimeFormatter DATE_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");
    private static final DateTimeFormatter HOUR_MINUTE =
            DateTimeFormatter.ofPattern("HH:mm");

    public String format(
            String hotelName,
            ZoneId hotelZone,
            HourlyMetrics metrics,
            Optional<RevenuePaceConfig> config,
            MappedInventorySnapshot inventory,
            List<InventoryIncident> incidents,
            Map<SourceSystem, SourceFreshness> freshness,
            CompletenessState completeness,
            ChannelBookingSummary ctrip,
            ChannelBookingSummary meituan) {
        hotelName = requireText(hotelName, "hotelName");
        Objects.requireNonNull(hotelZone, "hotelZone");
        Objects.requireNonNull(metrics, "metrics");
        config = Objects.requireNonNull(config, "config");
        Objects.requireNonNull(inventory, "inventory");
        incidents = List.copyOf(Objects.requireNonNull(incidents, "incidents"));
        freshness = Map.copyOf(Objects.requireNonNull(freshness, "freshness"));
        Objects.requireNonNull(completeness, "completeness");
        Objects.requireNonNull(ctrip, "ctrip");
        Objects.requireNonNull(meituan, "meituan");

        var cutoff = metrics.cutoffAt().atZone(hotelZone);
        var previousCutoff = metrics.cutoffAt().minusSeconds(3600).atZone(hotelZone);
        var current = metrics.current();
        var body = new StringBuilder();
        body.append("【SIMULATION｜DELIVERY_BLOCKED】\n");
        body.append(hotelName).append("｜今日收益管理\n");
        body.append("⏰ 统计时间｜").append(DATE_TIME.format(cutoff)).append("\n\n");

        body.append("📌 今日压力\n");
        body.append("今日可售｜").append(current
                .map(value -> value.currentAvailable() + "间")
                .orElse("无法判断")).append("\n");
        body.append("差额目标｜").append(money(metrics.targetGap())).append("\n");
        body.append("每间均价｜").append(money(metrics.requiredRemainingAdr())).append("\n");
        body.append("售完房型｜");
        if (inventory.soldOutPhysicalRoomTypes().isEmpty()) {
            body.append("无\n");
        } else {
            body.append("\n");
            inventory.soldOutPhysicalRoomTypes().forEach(
                    name -> body.append("· ").append(name).append("\n"));
        }
        separator(body);

        body.append("🎯 今日进度\n");
        body.append("目标任务｜").append(config
                .map(value -> "¥" + decimal(value.dailyTarget(), 2))
                .orElse("暂未配置标准")).append("\n");
        body.append("目标均价｜").append(config
                .map(value -> "¥" + decimal(value.targetAdr(), 2))
                .orElse("暂未配置标准")).append("\n");
        body.append("完成指标｜").append(percent(metrics.targetProgress())).append("\n");
        separator(body);

        body.append("🔄 实时经营对比\n");
        body.append("对比时间｜").append(HOUR_MINUTE.format(previousCutoff))
                .append("→").append(HOUR_MINUTE.format(cutoff)).append("\n");
        if (metrics.businessDayFirstReport()) {
            body.append("实时变化｜不适用（营业日首报）\n");
            body.append("总营业额｜").append(money(metrics.totalRevenue())).append("\n");
            body.append("平均房价｜").append(money(metrics.adr())).append("\n");
            body.append("单房收益｜").append(money(metrics.revpar())).append("\n");
            body.append("今日已售｜").append(current
                    .map(value -> value.overnightSold() + "间")
                    .orElse("无法判断")).append("\n");
        } else {
            appendComparison(body, metrics);
        }
        separator(body);

        body.append("📝 收益判断\n");
        body.append("旺季标准｜").append(percent(config
                .map(value -> MetricValue.available(value.revenuePaceStandard()))
                .orElseGet(() -> MetricValue.notConfigured("TARGET_OR_PACE_NOT_CONFIGURED"))))
                .append("\n");
        body.append("目标进度｜").append(percent(metrics.targetProgress()))
                .append("（").append(signedPoints(metrics.revenuePaceDeviation())).append("）\n");
        body.append("售卖进度｜").append(percent(metrics.sellProgress()))
                .append("（").append(signedPoints(metrics.sellPaceDeviation())).append("）\n");
        body.append("组合判断｜").append(pace(metrics.revenuePaceStatus()))
                .append(" × ").append(pace(metrics.sellPaceStatus())).append("\n");
        body.append("价格状态｜").append(price(metrics.priceStatus())).append("\n");
        body.append("每时速度｜售卖").append(signedPoints(metrics.hourlySellSpeed()))
                .append("｜目标").append(signedPoints(metrics.hourlyTargetSpeed())).append("\n");
        body.append("库存状态｜").append(inventoryLine(inventory, incidents)).append("\n");
        body.append("规则结论｜").append(ruleConclusion(metrics, completeness)).append("\n");
        separator(body);

        body.append("【订单情况汇报】\n");
        body.append("✅ 今日整体：\n");
        body.append(channelLine("携程", ctrip.businessDayCumulative(),
                freshness.get(SourceSystem.CTRIP))).append("\n");
        body.append(channelLine("美团", meituan.businessDayCumulative(),
                freshness.get(SourceSystem.MEITUAN))).append("\n\n");
        body.append("✅ ").append(HOUR_MINUTE.format(previousCutoff)).append("→")
                .append(HOUR_MINUTE.format(cutoff)).append("时间段：\n");
        body.append(channelLine("携程", ctrip.hourWindow(),
                freshness.get(SourceSystem.CTRIP))).append("\n");
        body.append(channelLine("美团", meituan.hourWindow(),
                freshness.get(SourceSystem.MEITUAN))).append("\n");
        separator(body);

        body.append("AI经营建议：");
        if (completeness != CompletenessState.COMPLETE) {
            body.append("数据不完整，暂不建议据此调价或放量。");
        } else if (!incidents.isEmpty()) {
            body.append("规则回退｜先处理房态不匹配任务，完成后等待新鲜采集复核；当前不自动调价或放房。");
        } else {
            body.append("规则回退｜保持主力房价格，观察下一时段；系统不自动调价、放房或关房。");
        }
        return body.toString();
    }

    private static void appendComparison(StringBuilder body, HourlyMetrics metrics) {
        var current = metrics.current().orElse(null);
        var previous = metrics.previous().orElse(null);
        if (current == null || previous == null) {
            body.append("总营业额｜").append(money(metrics.totalRevenue())).append("（无法比较）\n");
            body.append("平均房价｜").append(money(metrics.adr())).append("（无法比较）\n");
            body.append("单房收益｜").append(money(metrics.revpar())).append("（无法比较）\n");
            body.append("今日已售｜").append(current == null
                    ? "无法判断" : current.overnightSold() + "间").append("（无法比较）\n");
            return;
        }
        var previousOvernight = previous.totalRoomRevenue().subtract(previous.hourlyRoomRevenue());
        var previousTotal = previous.effectiveSellableTotal()
                .orElse(previous.overnightSold() + previous.currentAvailable());
        var previousAdr = previous.overnightSold() == 0
                ? Optional.<BigDecimal>empty()
                : Optional.of(previousOvernight.divide(
                        BigDecimal.valueOf(previous.overnightSold()), 12, RoundingMode.HALF_UP));
        var previousRevpar = previousTotal == 0
                ? Optional.<BigDecimal>empty()
                : Optional.of(previousOvernight.divide(
                        BigDecimal.valueOf(previousTotal), 12, RoundingMode.HALF_UP));
        body.append("总营业额｜").append(money(metrics.totalRevenue()))
                .append("（").append(delta(
                        current.totalRoomRevenue().subtract(previous.totalRoomRevenue()), 2))
                .append("）\n");
        body.append("平均房价｜").append(money(metrics.adr()))
                .append("（").append(metricDelta(metrics.adr(), previousAdr)).append("）\n");
        body.append("单房收益｜").append(money(metrics.revpar()))
                .append("（").append(metricDelta(metrics.revpar(), previousRevpar)).append("）\n");
        body.append("今日已售｜").append(current.overnightSold()).append("间（")
                .append(integerDelta(current.overnightSold() - previous.overnightSold()))
                .append("）\n");
    }

    private static String inventoryLine(
            MappedInventorySnapshot inventory,
            List<InventoryIncident> incidents) {
        var soldOut = inventory.soldOutPhysicalRoomTypes().isEmpty()
                ? "无实体房型售罄"
                : "实体房型售罄：" + String.join("、", inventory.soldOutPhysicalRoomTypes());
        if (incidents.isEmpty()) {
            return soldOut + "；逐产品房态一致";
        }
        return soldOut + "；发现" + incidents.size() + "个逐产品P1房态不匹配";
    }

    private static String channelLine(
            String name,
            RoomNightBucket bucket,
            SourceFreshness freshness) {
        if (freshness == null || !freshness.fresh()) {
            return name + "：无法判断（来源不新鲜）";
        }
        return name + "：" + bucket.addedTotal() + "间夜"
                + "（当日+" + bucket.addedToday()
                + "，远期+" + bucket.addedFuture()
                + "，取消/减少-" + bucket.removedTotal()
                + "，净变更" + signedInteger(bucket.netTotal()) + "）";
    }

    private static String ruleConclusion(
            HourlyMetrics metrics,
            CompletenessState completeness) {
        if (completeness != CompletenessState.COMPLETE) {
            return "来源不完整，经营与库存判断已降级。";
        }
        if (!metrics.consistencyValid()) {
            return "发现一致性异常，停止经营状态判断。";
        }
        return "营业额" + pace(metrics.revenuePaceStatus())
                + "，售卖进度" + pace(metrics.sellPaceStatus()) + "。";
    }

    private static String money(MetricValue metric) {
        return switch (metric.state()) {
            case AVAILABLE -> "¥" + decimal(metric.requiredValue(), 2);
            case NOT_APPLICABLE -> "不适用";
            case NOT_CONFIGURED -> "暂未配置标准";
            case UNAVAILABLE -> "无法判断";
            case CONSISTENCY_ERROR -> "无法判断（一致性异常）";
        };
    }

    private static String percent(MetricValue metric) {
        return switch (metric.state()) {
            case AVAILABLE -> decimal(metric.requiredValue().multiply(BigDecimal.valueOf(100)), 1) + "%";
            case NOT_APPLICABLE -> "不适用";
            case NOT_CONFIGURED -> "暂未配置标准";
            case UNAVAILABLE -> "无法判断";
            case CONSISTENCY_ERROR -> "无法判断（一致性异常）";
        };
    }

    private static String signedPoints(MetricValue metric) {
        return switch (metric.state()) {
            case AVAILABLE -> {
                var points = metric.requiredValue().multiply(BigDecimal.valueOf(100));
                yield signed(points, 1) + "点";
            }
            case NOT_APPLICABLE -> metric.reason().equals("BUSINESS_DAY_FIRST_REPORT")
                    ? "不适用（营业日首报）" : "不适用";
            case NOT_CONFIGURED -> "暂未配置标准";
            case UNAVAILABLE -> "无法判断";
            case CONSISTENCY_ERROR -> "无法判断（一致性异常）";
        };
    }

    private static String metricDelta(MetricValue current, Optional<BigDecimal> previous) {
        if (current.state() != MetricState.AVAILABLE || previous.isEmpty()) {
            return "无法比较";
        }
        return delta(current.requiredValue().subtract(previous.orElseThrow()), 2);
    }

    private static String delta(BigDecimal value, int scale) {
        var rounded = value.abs().setScale(scale, RoundingMode.HALF_UP);
        if (value.signum() > 0) {
            return "↑" + rounded.toPlainString();
        }
        if (value.signum() < 0) {
            return "↓" + rounded.toPlainString();
        }
        return "→" + rounded.toPlainString();
    }

    private static String integerDelta(int value) {
        if (value > 0) {
            return "↑" + value;
        }
        if (value < 0) {
            return "↓" + Math.abs(value);
        }
        return "→0";
    }

    private static String signedInteger(int value) {
        return value > 0 ? "+" + value : Integer.toString(value);
    }

    private static String signed(BigDecimal value, int scale) {
        var rounded = value.setScale(scale, RoundingMode.HALF_UP);
        return rounded.signum() > 0 ? "+" + rounded.toPlainString() : rounded.toPlainString();
    }

    private static String decimal(BigDecimal value, int scale) {
        return value.setScale(scale, RoundingMode.HALF_UP).toPlainString();
    }

    private static String pace(PaceStatus status) {
        return switch (status) {
            case LAGGING -> "落后";
            case ON_PACE -> "符合节奏";
            case AHEAD -> "领先";
            case UNAVAILABLE -> "无法判断";
        };
    }

    private static String price(PriceStatus status) {
        return switch (status) {
            case LOW -> "偏低";
            case REASONABLE -> "合理";
            case HIGH -> "偏高";
            case UNAVAILABLE -> "无法判断";
        };
    }

    private static void separator(StringBuilder body) {
        body.append("━━━━━━━━━━\n");
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
