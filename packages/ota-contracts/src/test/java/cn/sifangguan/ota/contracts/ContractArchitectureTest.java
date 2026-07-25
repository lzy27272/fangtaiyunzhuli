package cn.sifangguan.ota.contracts;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ContractArchitectureTest {
    @Test
    void mainContractsRemainFrameworkAndDatabaseIndependent() throws IOException {
        var sourceRoot = Path.of("src", "main", "java");
        try (var paths = Files.walk(sourceRoot)) {
            for (var file : paths.filter(path -> path.toString().endsWith(".java")).toList()) {
                var source = Files.readString(file, StandardCharsets.UTF_8);
                assertFalse(source.contains("import org.springframework."), file + " imports Spring");
                assertFalse(source.contains("import jakarta.persistence."), file + " imports JPA");
                assertFalse(source.contains("import java.sql."), file + " imports JDBC");
                assertFalse(source.contains("cn.sifangguan.hotelaios"), file + " depends on the AI platform");
            }
        }
    }

    @Test
    void envelopeSchemasArePackagedAndDeclareClosedMetadata() throws IOException {
        assertClosedSchema("schema/domain-event-envelope.schema.json", "eventId", "idempotencyKey");
        assertClosedSchema(
                "schema/standard-record-envelope.schema.json",
                "recordId", "evidence", "sourceEffectiveAt", "sourceDetectionInterval",
                "fromExclusive", "toInclusive");
    }

    @Test
    void standardRecordSchemaRequiresExactlyOneSourceTimeEvidenceShape() throws IOException {
        var schema = readSchema("schema/standard-record-envelope.schema.json");

        assertTrue(schema.contains("\"oneOf\""));
        assertTrue(schema.contains(
                "\"sourceEffectiveAt\": { \"type\": [\"string\", \"null\"], \"format\": \"date-time\" }"));
        assertTrue(schema.contains("\"sourceEffectiveAt\": { \"type\": \"string\" }"));
        assertTrue(schema.contains("\"sourceDetectionInterval\": { \"type\": \"null\" }"));
        assertTrue(schema.contains("\"sourceEffectiveAt\": { \"type\": \"null\" }"));
        assertTrue(schema.contains("\"sourceDetectionInterval\": { \"type\": \"object\" }"));
    }

    private static void assertClosedSchema(String resource, String... requiredTerms) throws IOException {
        var schema = readSchema(resource);
        assertTrue(schema.contains("\"additionalProperties\": false"));
        for (var requiredTerm : requiredTerms) {
            assertTrue(schema.contains("\"" + requiredTerm + "\""), requiredTerm + " missing from " + resource);
        }
    }

    private static String readSchema(String resource) throws IOException {
        var input = ContractArchitectureTest.class.getClassLoader().getResourceAsStream(resource);
        assertTrue(input != null, resource + " is missing");
        try (input) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
