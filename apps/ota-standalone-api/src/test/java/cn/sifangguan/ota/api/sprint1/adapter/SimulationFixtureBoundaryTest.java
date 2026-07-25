package cn.sifangguan.ota.api.sprint1.adapter;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class SimulationFixtureBoundaryTest {
    @Test
    void targetAndPaceDateCoverFrozenBusinessDateAndExecutionDiffersFromCutoff() {
        assertThat(JdbcSprint1ControlPlanePort.SIMULATION_BUSINESS_DATE)
                .isEqualTo(LocalDate.of(2026, 7, 19));
        assertThat(JdbcSprint1ControlPlanePort.SIMULATION_EXECUTION_CLOCK)
                .isEqualTo(Instant.parse("2026-07-19T10:06:00Z"));
        assertThat(JdbcSprint1ControlPlanePort.SIMULATION_CUTOFF)
                .isEqualTo(Instant.parse("2026-07-19T10:00:00Z"));
        assertThat(JdbcSprint1ControlPlanePort.SIMULATION_EXECUTION_CLOCK)
                .isAfter(JdbcSprint1ControlPlanePort.SIMULATION_CUTOFF);
    }

    @Test
    void seedsEveryWorkerFixtureProductWithItsStableSourceKeyHash() throws Exception {
        List<String> expected = List.of(
                "PMS-VIEW-TWIN",
                "PMS-LUX-KING",
                "PMS-ELEGANT-TWIN",
                "PMS-FAMILY",
                "PMS-STANDARD",
                "CT-VIEW-NO-BREAKFAST",
                "CT-VIEW-BREAKFAST",
                "CT-LUX-NO-BREAKFAST",
                "CT-STANDARD-NO-BREAKFAST",
                "MT-LUX-BREAKFAST",
                "MT-STANDARD-NO-BREAKFAST",
                "MT-ELEGANT");

        assertThat(JdbcSprint1ControlPlanePort.simulationProductCodes())
                .containsExactlyElementsOf(expected);
        assertThat(expected).filteredOn(code -> code.startsWith("PMS-")).hasSize(5);
        assertThat(expected)
                .filteredOn(code -> code.startsWith("CT-") || code.startsWith("MT-"))
                .hasSize(7);
        for (String code : expected) {
            String expectedHash = HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(code.getBytes(StandardCharsets.UTF_8)));
            assertThat(JdbcSprint1ControlPlanePort.simulationProductHashes())
                    .containsEntry(code, expectedHash);
        }
    }

    @Test
    void inventoryMismatchDetectsBothOtaLessAndOtaMoreThanPms() {
        assertThat(JdbcSprint1ControlPlanePort.inventoryCountsMismatch(
                5, Map.of("CTRIP:A", 4))).isTrue();
        assertThat(JdbcSprint1ControlPlanePort.inventoryCountsMismatch(
                5, Map.of("MEITUAN:B", 6))).isTrue();
        assertThat(JdbcSprint1ControlPlanePort.inventoryCountsMismatch(
                5, Map.of("CTRIP:A", 5, "MEITUAN:B", 5))).isFalse();
    }

    @Test
    void paceSeedUsesTheFixedUtcCutoffConvertedToEachHotelsLocalTimezone() {
        assertThat(JdbcSprint1ControlPlanePort.simulationLocalCutoff("Asia/Shanghai"))
                .isEqualTo(LocalTime.of(18, 0));
        assertThat(JdbcSprint1ControlPlanePort.simulationLocalCutoff("America/New_York"))
                .isEqualTo(LocalTime.of(6, 0));
        assertThat(JdbcSprint1ControlPlanePort.simulationPacePoints("America/New_York"))
                .filteredOn(point -> point.cutoffLocalTime().equals(LocalTime.of(6, 0)))
                .singleElement()
                .satisfies(point -> {
                    assertThat(point.revenueProgressPercent())
                            .isEqualByComparingTo("88.2");
                    assertThat(point.soldProgressPercent())
                            .isEqualByComparingTo("88.2");
                });
    }
}
