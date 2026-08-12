package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.Optional;

@Component
final class PmsMonthlyKpiReader {
    private final ObjectMapper objectMapper;

    PmsMonthlyKpiReader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    Optional<MonthlySummary> latest(Path path, String sourceHotelId, LocalDate from, LocalDate to) {
        if (path == null || !Files.isRegularFile(path) || sourceHotelId == null || sourceHotelId.isBlank()) {
            return Optional.empty();
        }
        try {
            JsonNode records = objectMapper.readTree(path.toFile()).path("records");
            if (!records.isArray()) return Optional.empty();
            java.util.List<MonthlySummary> matches = new java.util.ArrayList<>();
            for (JsonNode record : records) {
                if (!sourceHotelId.equals(record.path("sourceHotelId").asText())) continue;
                if (!from.toString().equals(record.path("period").path("from").asText())) continue;
                if (!to.toString().equals(record.path("period").path("to").asText())) continue;
                MonthlySummary parsed = parse(record);
                if (parsed != null) matches.add(parsed);
            }
            return matches.stream().max(Comparator.comparing(MonthlySummary::collectedAt));
        } catch (IOException exception) {
            throw new IllegalStateException("无法读取PMS月度KPI脱敏汇总", exception);
        }
    }

    private MonthlySummary parse(JsonNode record) {
        try {
            JsonNode period = record.path("period");
            JsonNode metrics = record.path("metrics");
            JsonNode validation = record.path("validation");
            return new MonthlySummary(
                    record.path("sourceHotelId").asText(),
                    record.path("sourceHotelCode").asText(),
                    record.path("sourceHotelName").asText(),
                    OffsetDateTime.parse(record.path("collectedAt").asText()),
                    LocalDate.parse(period.path("from").asText()),
                    LocalDate.parse(period.path("to").asText()),
                    period.path("expectedDayCount").asInt(),
                    period.path("validDistinctDayCount").asInt(),
                    period.path("missingDates").size(),
                    period.path("duplicateDates").size(),
                    decimal(metrics, "overnightSoldRoomNights"),
                    decimal(metrics, "effectiveSellableRoomNights"),
                    decimal(metrics, "roomRevenue"),
                    decimal(metrics, "occupancyRate"),
                    decimal(metrics, "adr"),
                    decimal(metrics, "revPar"),
                    validation.path("coverageState").asText("UNAVAILABLE"),
                    validation.path("numericState").asText("UNAVAILABLE"),
                    validation.path("aggregateCrosscheckState").asText("UNAVAILABLE"),
                    validation.path("denominatorSource").asText("UNAVAILABLE"),
                    validation.path("hourlyRoomExclusionState").asText("UNAVAILABLE"),
                    validation.path("accuracyState").asText("UNAVAILABLE"),
                    validation.path("capacityEvidence").path("state").asText("UNAVAILABLE"),
                    decimal(validation.path("capacityEvidence"), "roomCapacity"),
                    record.path("responseContentSha256").asText(""),
                    record.path("officialScoreEligible").asBoolean(false)
            );
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private BigDecimal decimal(JsonNode parent, String field) {
        JsonNode value = parent.path(field);
        return value.isNumber() ? value.decimalValue() : null;
    }

    record MonthlySummary(
            String sourceHotelId,
            String sourceHotelCode,
            String sourceHotelName,
            OffsetDateTime collectedAt,
            LocalDate from,
            LocalDate to,
            int expectedDayCount,
            int validDistinctDayCount,
            int missingDayCount,
            int duplicateDayCount,
            BigDecimal overnightSoldRoomNights,
            BigDecimal effectiveSellableRoomNights,
            BigDecimal roomRevenue,
            BigDecimal occupancyRate,
            BigDecimal adr,
            BigDecimal revPar,
            String coverageState,
            String numericState,
            String aggregateCrosscheckState,
            String denominatorSource,
            String hourlyRoomExclusionState,
            String accuracyState,
            String capacityEvidenceState,
            BigDecimal roomCapacity,
            String responseContentSha256,
            boolean officialScoreEligible
    ) {
        boolean candidateEligible() {
            return "PASS".equals(coverageState)
                    && "PASS".equals(numericState)
                    && "PASS".equals(aggregateCrosscheckState)
                    && expectedDayCount == validDistinctDayCount
                    && missingDayCount == 0
                    && duplicateDayCount == 0
                    && occupancyRate != null;
        }
    }
}
