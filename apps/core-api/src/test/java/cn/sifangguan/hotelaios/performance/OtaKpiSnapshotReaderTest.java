package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;

class OtaKpiSnapshotReaderTest {
    @TempDir
    Path tempDir;

    @Test
    void returnsOnlyAllowedTenantAndKeepsLatestSnapshotPerBusinessDate() throws Exception {
        Path hotels = tempDir.resolve("hotels.json");
        Path snapshots = tempDir.resolve("snapshots.json");
        Files.writeString(hotels, """
                [
                  {"tenantCode":"001","hotelId":"h1","hotelCode":"001","hotelName":"门店一","pmsProviderCode":"TEST_PMS","sourceProfile":"profile-001","sourceConnectionState":"AVAILABLE","sourceConnectionMessage":"月报可用","cookie":"never"},
                  {"tenantCode":"999","hotelId":"h2","hotelCode":"002","hotelName":"越权门店"}
                ]
                """);
        Files.writeString(snapshots, """
                {"h1":[
                  {"hotelId":"h1","businessDate":"2026-08-01","observedAt":"2026-08-01T10:00:00+08:00","completeness":"PARTIAL","orders":[{"bookerMobile":"secret"}],"overview":{"roomCount":10,"roomNights":8,"roomFee":800}},
                  {"hotelId":"h1","businessDate":"2026-08-01","observedAt":"2026-08-01T23:00:00+08:00","completeness":"COMPLETE","orders":[{"bookerMobile":"secret"}],"overview":{"roomCount":10,"roomNights":9,"roomFee":900}}
                ],"h2":[{"businessDate":"2026-08-01","observedAt":"2026-08-01T23:00:00+08:00","overview":{"roomCount":1}}]}
                """);

        var result = new OtaKpiSnapshotReader(new ObjectMapper()).read(hotels, snapshots, "001");

        assertThat(result).hasSize(1);
        assertThat(result.getFirst().hotelName()).isEqualTo("门店一");
        assertThat(result.getFirst().pmsProviderCode()).isEqualTo("TEST_PMS");
        assertThat(result.getFirst().sourceProfile()).isEqualTo("profile-001");
        assertThat(result.getFirst().sourceConnectionState()).isEqualTo("AVAILABLE");
        assertThat(result.getFirst().sourceConnectionMessage()).isEqualTo("月报可用");
        assertThat(result.getFirst().snapshots()).hasSize(1);
        assertThat(result.getFirst().latest().overview().roomNights()).isEqualByComparingTo("9");
    }
}
