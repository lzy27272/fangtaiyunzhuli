package cn.sifangguan.ota.worker.simulation.domain;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class SimulationOutboxFactory {
    public List<SimulationOutboxPreview> create(
            TenantHotelRef scope,
            LocalDate businessDate,
            Instant cutoffAt,
            String hourlyBrief,
            List<InventoryIncident> incidents,
            Instant createdAt) {
        return create(
                scope,
                businessDate,
                cutoffAt,
                hourlyBrief,
                incidents,
                createdAt,
                UUID.nameUUIDFromBytes(
                        ("simulation-hourly|" + scope.tenantId() + "|"
                                + scope.hotelId() + "|" + businessDate + "|"
                                + cutoffAt).getBytes(StandardCharsets.UTF_8)),
                false);
    }

    public List<SimulationOutboxPreview> create(
            TenantHotelRef scope,
            LocalDate businessDate,
            Instant cutoffAt,
            String hourlyBrief,
            List<InventoryIncident> incidents,
            Instant createdAt,
            UUID simulationRunId,
            boolean lateReplay) {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(businessDate, "businessDate");
        Objects.requireNonNull(cutoffAt, "cutoffAt");
        hourlyBrief = requireText(hourlyBrief, "hourlyBrief");
        incidents = List.copyOf(Objects.requireNonNull(incidents, "incidents"));
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(simulationRunId, "simulationRunId");

        var previews = new ArrayList<SimulationOutboxPreview>();
        var hourlyKey = "wecom:hourly:" + scope.hotelId()
                + ":" + businessDate + ":" + cutoffAt
                + ":simulation:" + simulationRunId;
        if (lateReplay) {
            previews.add(preview(
                    "HOURLY_BRIEF_REPLAY",
                    hourlyKey + ":late-replay:1",
                    "【SIMULATION｜DELIVERY_BLOCKED】\n"
                            + "【过时简报补发】\n"
                            + hourlyBrief.substring(
                                    "【SIMULATION｜DELIVERY_BLOCKED】\n".length()),
                    createdAt));
        } else {
            previews.add(preview("HOURLY_BRIEF", hourlyKey, hourlyBrief, createdAt));
        }
        for (var incident : incidents) {
            var key = "wecom:p1:" + scope.hotelId() + ":"
                    + incident.incidentId() + ":first";
            var risk = incident.direction() == InventoryRiskDirection.OTA_MORE_THAN_PMS
                    ? "P1超卖风险"
                    : "P1房态不匹配风险";
            var body = "【SIMULATION｜DELIVERY_BLOCKED】\n"
                    + "🚨 " + risk + "\n"
                    + "渠道｜" + incident.channel() + "\n"
                    + "实体房型｜" + incident.physicalRoomTypeName() + "\n"
                    + "售卖产品｜" + incident.productName() + "\n"
                    + "PMS可售｜" + incident.pmsAvailable() + "\n"
                    + "OTA可售｜" + incident.otaAvailable() + "\n"
                    + "差额｜" + incident.difference() + "\n"
                    + "处置时限｜10分钟内提交处理说明\n"
                    + "投递状态｜模拟预览，禁止发送";
            previews.add(preview("P1_FIRST", key, body, createdAt));
        }
        return List.copyOf(previews);
    }

    private static SimulationOutboxPreview preview(
            String messageType,
            String key,
            String body,
            Instant createdAt) {
        return new SimulationOutboxPreview(
                UUID.nameUUIDFromBytes(("simulation-outbox|" + key)
                        .getBytes(StandardCharsets.UTF_8)),
                messageType,
                key,
                body,
                sha256(body),
                true,
                OutboxEnvironment.SIMULATION,
                OutboxDeliveryState.DELIVERY_BLOCKED,
                createdAt);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
