package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;

import static org.assertj.core.api.Assertions.assertThat;

class PmsMonthlyKpiReaderTest {
    @TempDir
    Path tempDir;

    @Test
    void selectsLatestExactHotelAndNaturalMonthSummary() throws Exception {
        Path file = tempDir.resolve("monthly.json");
        Files.writeString(file, """
                {"records":[
                  {"sourceHotelId":"h1","collectedAt":"2026-08-10T00:00:00Z",
                   "period":{"from":"2026-07-01","to":"2026-07-31","expectedDayCount":31,"validDistinctDayCount":31,"missingDates":[],"duplicateDates":[]},
                   "metrics":{"overnightSoldRoomNights":1400,"effectiveSellableRoomNights":1457,"occupancyRate":0.96087852},
                   "validation":{"coverageState":"PASS","numericState":"PASS","aggregateCrosscheckState":"PASS","hourlyRoomExclusionState":"UNVERIFIED_PMS_FIELD_SEMANTICS"}},
                  {"sourceHotelId":"h1","collectedAt":"2026-08-12T00:00:00Z",
                   "period":{"from":"2026-07-01","to":"2026-07-31","expectedDayCount":31,"validDistinctDayCount":31,"missingDates":[],"duplicateDates":[]},
                   "metrics":{"overnightSoldRoomNights":1440,"effectiveSellableRoomNights":1457,"occupancyRate":0.98833219},
                   "validation":{"coverageState":"PASS","numericState":"PASS","aggregateCrosscheckState":"PASS","hourlyRoomExclusionState":"UNVERIFIED_PMS_FIELD_SEMANTICS"}}
                ]}
                """);

        var value = new PmsMonthlyKpiReader(new ObjectMapper()).latest(
                file, "h1", LocalDate.parse("2026-07-01"), LocalDate.parse("2026-07-31"));

        assertThat(value).isPresent();
        assertThat(value.orElseThrow().overnightSoldRoomNights()).isEqualByComparingTo("1440");
        assertThat(value.orElseThrow().candidateEligible()).isTrue();
        assertThat(value.orElseThrow().officialScoreEligible()).isFalse();
    }

    @Test
    void acceptsDirectJy07OvernightOccupancyAsOfficialScoreEvidence() throws Exception {
        Path file = tempDir.resolve("monthly-jy07.json");
        Files.writeString(file, """
                {"records":[
                  {"sourceHotelId":"h1","collectedAt":"2026-08-13T00:00:00Z","officialScoreEligible":true,
                   "period":{"from":"2026-07-01","to":"2026-07-31","expectedDayCount":31,"validDistinctDayCount":31,"missingDates":[],"duplicateDates":[]},
                   "metrics":{"occupancyRate":0.9897},
                   "validation":{"coverageState":"PASS","numericState":"PASS","aggregateCrosscheckState":"PASS","hourlyRoomExclusionState":"VERIFIED_DIRECT_OVERNIGHT_OCCUPANCY","accuracyState":"NUMERICALLY_VALIDATED"}}
                ]}
                """);

        var value = new PmsMonthlyKpiReader(new ObjectMapper()).latest(
                file, "h1", LocalDate.parse("2026-07-01"), LocalDate.parse("2026-07-31"));

        assertThat(value).isPresent();
        assertThat(value.orElseThrow().occupancyRate()).isEqualByComparingTo("0.9897");
        assertThat(value.orElseThrow().hourlyRoomExclusionState())
                .isEqualTo("VERIFIED_DIRECT_OVERNIGHT_OCCUPANCY");
        assertThat(value.orElseThrow().officialScoreEligible()).isTrue();
    }
}
