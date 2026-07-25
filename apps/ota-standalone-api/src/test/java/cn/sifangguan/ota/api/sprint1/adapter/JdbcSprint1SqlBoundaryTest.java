package cn.sifangguan.ota.api.sprint1.adapter;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class JdbcSprint1SqlBoundaryTest {
    @Test
    void usesFixedPostgresControlFunctionsAndContainsNoOutboundClient() throws IOException {
        try (var input = getClass().getResourceAsStream(
                "/cn/sifangguan/ota/api/sprint1/adapter/JdbcSprint1ControlPlanePort.class")) {
            assertThat(input).isNotNull();
            String bytecodeConstants = new String(input.readAllBytes(), StandardCharsets.ISO_8859_1);
            assertThat(bytecodeConstants)
                    .contains("control.enqueue_ota_job")
                    .contains("ota.simulation_run")
                    .contains("ota.ota_command_idempotency")
                    .contains("pg_advisory_xact_lock")
                    .contains("SIMULATION_PIPELINE")
                    .contains("MANUAL_SIMULATION")
                    .contains("HOURLY_CUTOFF")
                    .contains("FILE_IMPORT")
                    .contains("BOOKING_EVENT")
                    .contains("INVENTORY_SELL_PRODUCT")
                    .contains("INVENTORY_ROOM_TYPE")
                    .contains("ROOM_REVENUE_AGGREGATE")
                    .contains("run.reconciliation_epoch = ?")
                    .contains("observation.reconciliation_epoch = ?")
                    .contains("adjustment.replacement_frozen_body")
                    .contains("adjustment.simulation_run_id")
                    .contains("replacement.snapshot_id = adjustment.replacement_snapshot_id")
                    .doesNotContain("RestTemplate")
                    .doesNotContain("WebClient")
                    .doesNotContain("HttpClient");
        }
    }

    @Test
    void secretStatusIsScopedToTheActiveVersionAndHiddenForFileFixture()
            throws IOException {
        String source = Files.readString(
                Path.of(
                        "src", "main", "java", "cn", "sifangguan", "ota",
                        "api", "sprint1", "adapter",
                        "JdbcSprint1ControlPlanePort.java"),
                StandardCharsets.UTF_8);

        assertThat(source)
                .contains(
                        "binding.connector_version_id =\n"
                                + "                                          version.connector_version_id")
                .contains("binding.binding_status <> 'REVOKED'")
                .contains("connector.adapter_code <> 'FILE_FIXTURE'");
    }

    @Test
    void snapshotMappingCarriesTheReconciliationEpochUsedByDependentReads() throws Exception {
        UUID snapshotId = UUID.randomUUID();
        UUID reconciliationEpoch = UUID.randomUUID();
        LocalDate businessDate = LocalDate.of(2026, 7, 19);
        Instant cutoff = Instant.parse("2026-07-19T10:00:00Z");
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getObject("snapshot_id", UUID.class)).thenReturn(snapshotId);
        when(resultSet.getObject("pms_business_date", LocalDate.class)).thenReturn(businessDate);
        when(resultSet.getTimestamp("cutoff_at")).thenReturn(Timestamp.from(cutoff));
        when(resultSet.getString("completeness_code")).thenReturn("COMPLETE");
        when(resultSet.getObject("reconciliation_epoch", UUID.class))
                .thenReturn(reconciliationEpoch);
        when(resultSet.getString("display_name")).thenReturn("Simulation Hotel");

        JdbcSprint1ControlPlanePort.SnapshotRow row =
                JdbcSprint1ControlPlanePort.mapSnapshot(resultSet, 0);

        assertThat(row.snapshotId()).isEqualTo(snapshotId);
        assertThat(row.businessDate()).isEqualTo(businessDate);
        assertThat(row.cutoffAt()).isEqualTo(cutoff);
        assertThat(row.reconciliationEpoch()).isEqualTo(reconciliationEpoch);
    }

    @Test
    void briefVersionMappingKeepsRevisionBodyCompletenessPublicationAndRunIdentity()
            throws Exception {
        UUID versionId = UUID.randomUUID();
        UUID simulationRunId = UUID.randomUUID();
        LocalDate businessDate = LocalDate.of(2026, 7, 19);
        Instant cutoff = Instant.parse("2026-07-19T10:00:00Z");
        Instant publishedAt = Instant.parse("2026-07-19T10:06:00Z");
        ResultSet resultSet = mock(ResultSet.class);
        when(resultSet.getObject("version_id", UUID.class)).thenReturn(versionId);
        when(resultSet.getObject("pms_business_date", LocalDate.class)).thenReturn(businessDate);
        when(resultSet.getTimestamp("cutoff_at")).thenReturn(Timestamp.from(cutoff));
        when(resultSet.getInt("revision_no")).thenReturn(3);
        when(resultSet.getString("completeness_code")).thenReturn("PARTIAL");
        when(resultSet.getString("version_body")).thenReturn("scenario brief body");
        when(resultSet.getTimestamp("published_at")).thenReturn(Timestamp.from(publishedAt));
        when(resultSet.getObject("simulation_run_id", UUID.class)).thenReturn(simulationRunId);
        when(resultSet.getString("delivery_status")).thenReturn("SIMULATED");
        when(resultSet.getBoolean("simulation_mode")).thenReturn(true);

        var view = JdbcSprint1ControlPlanePort.mapBrief(resultSet, 0);

        assertThat(view.briefId()).isEqualTo(versionId);
        assertThat(view.revisionNo()).isEqualTo(3);
        assertThat(view.completenessCode()).isEqualTo("PARTIAL");
        assertThat(view.content()).isEqualTo("scenario brief body");
        assertThat(view.publishedAt()).isEqualTo(publishedAt);
        assertThat(view.simulationRunId()).isEqualTo(simulationRunId);
        assertThat(view.simulationMode()).isTrue();
    }
}
