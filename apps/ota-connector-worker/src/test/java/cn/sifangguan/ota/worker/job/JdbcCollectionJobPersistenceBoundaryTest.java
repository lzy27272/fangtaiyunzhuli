package cn.sifangguan.ota.worker.job;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JdbcCollectionJobPersistenceBoundaryTest {
    @Test
    void ordinaryCollectionPersistsFactsBeforeAdvancingCheckpoint()
            throws IOException {
        var source = Files.readString(
                Path.of(
                        "src", "main", "java", "cn", "sifangguan", "ota",
                        "worker", "job", "JdbcCollectionJobRepository.java"),
                StandardCharsets.UTF_8);

        assertTrue(source.contains("control.claim_ota_job"));
        assertTrue(source.contains("\"COLLECTION\""));
        assertTrue(source.contains("ota.connector_collection_run"));
        assertTrue(source.contains("ota.connector_collection_attempt"));
        assertTrue(source.contains("INSERT INTO ota.source_raw_record"));
        assertTrue(source.contains("INSERT INTO ota.source_standard_record"));
        assertTrue(source.contains("ota.connector_stream_checkpoint"));
        assertTrue(source.contains("control.complete_ota_job"));
        assertTrue(source.indexOf("persistRun(job, outcome)")
                < source.indexOf("persistRecords(job, outcome"));
        assertTrue(source.indexOf("persistRecords(job, outcome")
                < source.indexOf("persistCheckpoint(job, outcome"));
        assertTrue(source.contains("source_record_key_hash"));
        assertTrue(source.contains("evidence_sha256"));
        assertTrue(source.contains("parser_version"));
        assertTrue(source.contains("normalized_payload"));
        assertTrue(source.contains("DO NOTHING"));
        assertTrue(source.contains("resultSafetyGate.validate"));
        assertFalse(source.contains("private static void validateEnvelope"));
        assertFalse(source.contains("COLLECTION_EVIDENCE_HOST_PATH_FORBIDDEN"));
        assertFalse(source.contains("Files.read"));
        assertFalse(source.contains("Path.of"));
    }
}
