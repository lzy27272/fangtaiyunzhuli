package cn.sifangguan.ota.contracts.openapi;

import cn.sifangguan.ota.contracts.api.Sprint1ApiDtos;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Sprint1OpenApiContractTest {
    private static final String RESOURCE =
            "openapi/ota-standalone-sprint1-v1.yaml";
    private static final Set<String> PATHS = Set.of(
            "/api/v1/ota/connector-adapters",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/monitor",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/briefs",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/incidents",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/outbox-preview",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs/{runId}",
            "/api/v1/group/ota/monitor",
            "/api/v1/group/ota/briefs",
            "/api/v1/group/ota/incidents",
            "/api/v1/ota/simulation/hotels",
            "/api/v1/ota/tenants/{tenantId}/configuration",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/hotel",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/connectors/{connectorId}",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/inventory-pools/{poolId}",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/products/{productId}",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/product-mappings/{mappingId}",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/targets/{targetId}",
            "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/pace-curves/{curveId}");

    @Test
    void publishesEveryImplementedSprint1PathWithDataEnvelopeAndWriteGuards()
            throws IOException {
        var contract = contract();
        var matcher = Pattern.compile(
                "^  (/api/v1/[^:]+):$",
                Pattern.MULTILINE).matcher(contract);
        var actual = new LinkedHashSet<String>();
        while (matcher.find()) {
            actual.add(matcher.group(1));
        }

        assertEquals(PATHS, actual);
        assertTrue(contract.contains("required: [data]"));
        assertTrue(contract.contains("name: Idempotency-Key"));
        assertTrue(contract.contains("required: [expectedRowVersion, reasonCode]"));
        assertTrue(contract.contains("const: no-store"));
    }

    @Test
    void everySprint1GetUsesItsConcreteStableResponseSchema() throws IOException {
        var contract = contract();
        var responsesByPath = Map.ofEntries(
                Map.entry(
                        "/api/v1/ota/connector-adapters",
                        "ConnectorAdapterListResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration",
                        "ConfigurationResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/monitor",
                        "MonitorResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/briefs",
                        "BriefListResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/incidents",
                        "IncidentListResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/outbox-preview",
                        "OutboxPreviewListResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs",
                        "SimulationRunListResponse"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs/{runId}",
                        "SimulationRunResponse"),
                Map.entry(
                        "/api/v1/group/ota/monitor",
                        "GroupMonitorResponse"),
                Map.entry(
                        "/api/v1/group/ota/briefs",
                        "GroupBriefListResponse"),
                Map.entry(
                        "/api/v1/group/ota/incidents",
                        "GroupIncidentListResponse"),
                Map.entry(
                        "/api/v1/ota/simulation/hotels",
                        "SimulationHotelDirectoryResponse"));
        var envelopesByResponse = Map.ofEntries(
                Map.entry("ConnectorAdapterListResponse", "ConnectorAdapterListEnvelope"),
                Map.entry("ConfigurationResponse", "ConfigurationEnvelope"),
                Map.entry("MonitorResponse", "MonitorEnvelope"),
                Map.entry("BriefListResponse", "BriefListEnvelope"),
                Map.entry("IncidentListResponse", "IncidentListEnvelope"),
                Map.entry("OutboxPreviewListResponse", "OutboxPreviewListEnvelope"),
                Map.entry("SimulationRunListResponse", "SimulationRunListEnvelope"),
                Map.entry("SimulationRunResponse", "SimulationRunEnvelope"),
                Map.entry("GroupMonitorResponse", "GroupMonitorEnvelope"),
                Map.entry("GroupBriefListResponse", "GroupBriefListEnvelope"),
                Map.entry("GroupIncidentListResponse", "GroupIncidentListEnvelope"),
                Map.entry("SimulationHotelDirectoryResponse", "SimulationHotelDirectoryEnvelope"));

        responsesByPath.forEach((path, responseName) -> {
            var pathContract = pathSection(contract, path);
            assertTrue(pathContract.contains(
                    "'200': {$ref: '#/components/responses/" + responseName + "'}"),
                    path + " must reference " + responseName);
        });
        envelopesByResponse.forEach((responseName, envelopeName) -> {
            assertTrue(schemaSection(contract, responseName).contains(
                    "schema: {$ref: '#/components/schemas/" + envelopeName + "'}"),
                    responseName + " must reference " + envelopeName);
            var envelope = schemaSection(contract, envelopeName);
            assertTrue(envelope.contains("required: [data]"), envelopeName);
            assertTrue(!envelope.contains("data: {}"), envelopeName);
        });
        assertTrue(!contract.contains("#/components/responses/DataResponse"));
        assertTrue(!contract.contains("data: {}"));
    }

    @Test
    void readSchemasFreezeEveryJdbcViewRecordField() throws IOException {
        var contract = contract();
        var fieldsBySchema = new LinkedHashMap<String, List<String>>();
        fieldsBySchema.put("ConnectorAdapterView", List.of(
                "code", "displayName", "sourceSystem", "simulationOnly", "streams"));
        fieldsBySchema.put("TenantView", List.of(
                "tenantId", "tenantCode", "displayName", "timezone", "status", "rowVersion"));
        fieldsBySchema.put("HotelView", List.of(
                "tenantId", "hotelId", "hotelCode", "displayName", "timezone",
                "lifecycleStatus", "collectionEnabled", "messageEnabled", "rowVersion"));
        fieldsBySchema.put("SecretReferenceStatus", List.of(
                "referenceConfigured", "referenceFingerprint",
                "authorizationStatus", "lastCheckedAt"));
        fieldsBySchema.put("ConnectorView", List.of(
                "connectorId", "adapterCode", "sourceCode", "enabled",
                "fixtureScenarioCode", "pollIntervalMinutes", "rowVersion", "secret"));
        fieldsBySchema.put("InventoryPoolView", List.of(
                "inventoryPoolId", "physicalRoomTypeCode",
                "displayName", "physicalRoomCount", "rowVersion"));
        fieldsBySchema.put("SellableProductView", List.of(
                "productId", "connectorId", "sourceCode", "externalProductCode",
                "displayName", "mealPlanCode", "rowVersion"));
        fieldsBySchema.put("ProductMappingView", List.of(
                "mappingVersionId", "productId", "inventoryPoolId",
                "validFrom", "validUntil", "rowVersion"));
        fieldsBySchema.put("RevenueTargetView", List.of(
                "targetVersionId", "businessDate",
                "roomRevenueTarget", "targetAdr", "rowVersion"));
        fieldsBySchema.put("PacePoint", List.of(
                "cutoffLocalTime", "revenueProgressPercent", "soldProgressPercent"));
        fieldsBySchema.put("PaceCurveView", List.of(
                "paceCurveVersionId", "curveCode", "validFrom",
                "validUntil", "points", "rowVersion"));
        fieldsBySchema.put("ConfigurationView", List.of(
                "tenant", "hotel", "connectors", "inventoryPools", "products",
                "productMappings", "targets", "paceCurves",
                "simulationMode", "outboundDeliveryBlocked"));
        fieldsBySchema.put("SourceFreshnessView", List.of(
                "sourceCode", "completeness", "sourceObservedAt", "ingestedAt"));
        fieldsBySchema.put("MetricValue", List.of("value", "unit", "state"));
        fieldsBySchema.put("InventoryView", List.of(
                "inventoryPoolId", "physicalRoomTypeCode", "displayName",
                "pmsAvailableRooms", "otaAvailableRooms", "state"));
        fieldsBySchema.put("MonitorView", List.of(
                "tenantId", "hotelId", "hotelName", "businessDate", "cutoffAt",
                "completeness", "simulationMode", "sources", "metrics", "inventory"));
        fieldsBySchema.put("BriefView", List.of(
                "briefId", "businessDate", "cutoffAt", "revisionNo",
                "completenessCode", "content", "publishedAt", "simulationRunId",
                "deliveryStatus", "simulationMode"));
        fieldsBySchema.put("IncidentView", List.of(
                "incidentId", "type", "status", "sourceCode", "directionCode",
                "openedAt", "lastObservedAt", "taskId", "rowVersion"));
        fieldsBySchema.put("OutboxPreview", List.of(
                "eventId", "messageKey", "messageType", "createdAt",
                "deliveryBlocked", "deliveryStatus", "bodyPreview"));
        fieldsBySchema.put("SimulationRunView", List.of(
                "runId", "scenarioCode", "status", "fixedClockAt", "scheduledFor",
                "startedAt", "completedAt", "briefId", "incidentIds", "rowVersion"));
        fieldsBySchema.put("TenantFailure", List.of("tenantId", "reasonCode"));
        fieldsBySchema.put("GroupMonitorResult", List.of("coverage", "values", "failures"));
        fieldsBySchema.put("GroupBriefListResult", List.of("coverage", "values", "failures"));
        fieldsBySchema.put("GroupIncidentListResult", List.of("coverage", "values", "failures"));
        fieldsBySchema.put("SimulationHotelView", List.of(
                "tenantId", "hotelId", "tenantCode", "tenantName", "hotelCode",
                "hotelName", "timezone", "lifecycleStatus", "collectionEnabled",
                "messageEnabled", "configuredMockConnectors", "simulationOnly", "rowVersion"));
        fieldsBySchema.put("SimulationHotelDirectoryView", List.of(
                "coverage", "hotels", "failedTenantIds"));

        fieldsBySchema.forEach((schemaName, fields) -> {
            var schema = schemaSection(contract, schemaName);
            var required = schema.substring(
                    schema.indexOf("required:"), schema.indexOf("properties:"));
            assertTrue(schema.contains("additionalProperties: false"), schemaName);
            for (var field : fields) {
                assertTrue(required.contains(field), schemaName + " required " + field);
                assertTrue(schema.contains(field + ":"), schemaName + " property " + field);
            }
        });
    }

    @Test
    void freezesFourScenariosAndFileFixtureSourceBoundary() throws IOException {
        var contract = contract();
        for (var scenario : Sprint1ApiDtos.SimulationScenarioCode.values()) {
            assertTrue(contract.contains(scenario.name()));
        }
        assertTrue(contract.contains("adapterCode: {const: FILE_FIXTURE}"));
        assertTrue(contract.contains("sourceCode: {const: OFFICIAL_EXPORT}"));
        assertTrue(contract.contains("required: [secretReference]"));

        assertThrows(
                IllegalArgumentException.class,
                () -> new Sprint1ApiDtos.ConnectorRequest(
                        0,
                        "SIMULATION_TEST",
                        Sprint1ApiDtos.AdapterCode.FILE_FIXTURE,
                        Sprint1ApiDtos.SourceCode.PMS,
                        true,
                        "BASELINE",
                        15,
                        Optional.empty()));
        new Sprint1ApiDtos.ConnectorRequest(
                0,
                "SIMULATION_TEST",
                Sprint1ApiDtos.AdapterCode.FILE_FIXTURE,
                Sprint1ApiDtos.SourceCode.OFFICIAL_EXPORT,
                true,
                "BASELINE",
                15,
                Optional.empty());
        assertThrows(
                IllegalArgumentException.class,
                () -> new Sprint1ApiDtos.ConnectorRequest(
                        0,
                        "SIMULATION_TEST",
                        Sprint1ApiDtos.AdapterCode.FILE_FIXTURE,
                        Sprint1ApiDtos.SourceCode.OFFICIAL_EXPORT,
                        true,
                        "BASELINE",
                        15,
                        Optional.of("vault://ota/pilot/source")));
    }

    @Test
    void commandReceiptSchemaMatchesTheActualPostResponseJson() throws IOException {
        var schema = contract().substring(
                contract().indexOf("    CommandReceipt:"),
                contract().indexOf("    SimulationRunEnvelope:"));
        var expectedFields = List.of(
                "commandId", "resourceId", "resultingRowVersion", "replayed");

        assertTrue(schema.contains(
                "required: [commandId, resourceId, resultingRowVersion, replayed]"));
        for (var field : expectedFields) {
            assertTrue(schema.contains(field + ":"));
        }
        assertTrue(!schema.contains("resourceType:"));
        assertTrue(!schema.contains("resultCode:"));
        assertTrue(!schema.contains("rowVersion:"));
        assertTrue(schema.contains("example:"));

        assertEquals(
                expectedFields,
                Arrays.stream(Sprint1ApiDtos.CommandReceipt.class.getRecordComponents())
                        .map(java.lang.reflect.RecordComponent::getName)
                        .toList());
        var receipt = new Sprint1ApiDtos.CommandReceipt(
                UUID.randomUUID().toString(), UUID.randomUUID(), 1, false);
        assertEquals(1, receipt.resultingRowVersion());
        assertTrue(!receipt.replayed());
    }

    @Test
    void connectorPostJsonSchemaUsesOnlyTheCodeOwnedAdapterDirectory()
            throws IOException {
        var contract = contract();
        var schema = contract.substring(
                contract.indexOf("    ConnectorRequest:"),
                contract.indexOf("    SimulationRunRequest:"));
        var adapterCodes = Arrays.stream(Sprint1ApiDtos.AdapterCode.values())
                .map(Enum::name)
                .toList();
        var expectedPostFields = List.of(
                "expectedRowVersion",
                "reasonCode",
                "adapterCode",
                "sourceCode",
                "enabled",
                "fixtureScenarioCode",
                "pollIntervalMinutes",
                "secretReference");

        assertEquals(
                List.of("MOCK_PMS", "MOCK_CTRIP", "MOCK_MEITUAN", "FILE_FIXTURE"),
                adapterCodes);
        assertTrue(schema.contains(
                "enum: [MOCK_PMS, MOCK_CTRIP, MOCK_MEITUAN, FILE_FIXTURE]"));
        assertTrue(!schema.contains("PMS_BROWSER"));
        assertTrue(!schema.contains("CTRIP_BROWSER"));
        assertTrue(!schema.contains("MEITUAN_BROWSER"));
        assertTrue(schema.contains(
                "required: [adapterCode, sourceCode, enabled, fixtureScenarioCode, pollIntervalMinutes]"));
        for (var field : expectedPostFields) {
            assertTrue(schema.contains(field + ":"));
        }
        assertTrue(schema.contains("adapterCode: MOCK_PMS"));
        assertTrue(schema.contains("sourceCode: PMS"));

        assertEquals(
                expectedPostFields,
                Arrays.stream(Sprint1ApiDtos.ConnectorRequest.class.getRecordComponents())
                        .map(java.lang.reflect.RecordComponent::getName)
                        .toList());
    }

    @Test
    void everyMutationPostReferencesItsConcreteRequestSchema() throws IOException {
        var contract = contract();
        var requestsByPath = Map.ofEntries(
                Map.entry(
                        "/api/v1/ota/simulation/hotels",
                        "InitializeSimulationHotelRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/configuration",
                        "TenantRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/hotel",
                        "HotelRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/connectors/{connectorId}",
                        "ConnectorRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/inventory-pools/{poolId}",
                        "InventoryPoolRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/products/{productId}",
                        "ProductRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/product-mappings/{mappingId}",
                        "ProductMappingRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/targets/{targetId}",
                        "TargetRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/configuration/pace-curves/{curveId}",
                        "PaceCurveRequest"),
                Map.entry(
                        "/api/v1/ota/tenants/{tenantId}/hotels/{hotelId}/simulation-runs",
                        "SimulationRunRequest"));

        requestsByPath.forEach((path, schemaName) -> {
            var pathContract = pathSection(contract, path);
            assertTrue(pathContract.contains("post:"), path);
            assertTrue(
                    pathContract.contains(
                            "schema: {$ref: '#/components/schemas/" + schemaName + "'}"),
                    path + " must reference " + schemaName);
        });
        assertTrue(!contract.contains(
                "requestBody: {$ref: '#/components/requestBodies/CommandBody'}"));
    }

    @Test
    void configurationMutationSchemasMatchEveryControllerRequestField()
            throws IOException {
        var contract = contract();
        var requiredFields = new LinkedHashMap<String, List<String>>();
        requiredFields.put("TenantRequest", List.of(
                "expectedRowVersion", "reasonCode", "tenantCode",
                "displayName", "timezone", "status"));
        requiredFields.put("HotelRequest", List.of(
                "expectedRowVersion", "reasonCode", "hotelCode",
                "displayName", "timezone", "lifecycleStatus",
                "collectionEnabled", "messageEnabled"));
        requiredFields.put("InventoryPoolRequest", List.of(
                "expectedRowVersion", "reasonCode", "physicalRoomTypeCode",
                "displayName", "physicalRoomCount"));
        requiredFields.put("ProductRequest", List.of(
                "expectedRowVersion", "reasonCode", "connectorId", "sourceCode",
                "externalProductCode", "displayName", "mealPlanCode"));
        requiredFields.put("ProductMappingRequest", List.of(
                "expectedRowVersion", "reasonCode", "productId", "inventoryPoolId"));
        requiredFields.put("TargetRequest", List.of(
                "expectedRowVersion", "reasonCode", "businessDate",
                "roomRevenueTarget", "targetAdr"));
        requiredFields.put("PaceCurveRequest", List.of(
                "expectedRowVersion", "reasonCode", "curveCode", "validFrom", "points"));

        requiredFields.forEach((schemaName, fields) -> {
            var schema = schemaSection(contract, schemaName);
            var required = schema.substring(
                    schema.indexOf("required:"), schema.indexOf("properties:"));
            var example = schema.substring(schema.indexOf("example:"));
            assertTrue(schema.contains("additionalProperties: false"), schemaName);
            assertTrue(schema.contains("example:"), schemaName);
            for (var field : fields) {
                assertTrue(required.contains(field), schemaName + " required " + field);
                assertTrue(schema.contains(field + ":"), schemaName + " property " + field);
                assertTrue(example.contains(field + ":"), schemaName + " example " + field);
            }
        });

        var tenant = schemaSection(contract, "TenantRequest");
        assertTrue(tenant.contains("enum: [DRAFT, ACTIVE, SUSPENDED]"));
        var hotel = schemaSection(contract, "HotelRequest");
        assertTrue(hotel.contains(
                "enum: [DRAFT, READY_FOR_TEST, SHADOW, UAT, LIVE, PAUSED]"));
        assertTrue(hotel.contains("messageEnabled: {type: boolean, const: false}"));
        var inventory = schemaSection(contract, "InventoryPoolRequest");
        assertTrue(inventory.contains(
                "physicalRoomCount: {type: integer, minimum: 1, maximum: 10000}"));
        var product = schemaSection(contract, "ProductRequest");
        assertTrue(product.contains("connectorId: {type: string, format: uuid}"));
        assertTrue(product.contains("enum: [PMS, CTRIP, MEITUAN, OFFICIAL_EXPORT]"));
        assertTrue(product.contains("enum: [ROOM_ONLY, BREAKFAST_INCLUDED]"));
        var mapping = schemaSection(contract, "ProductMappingRequest");
        assertTrue(mapping.contains("productId: {type: string, format: uuid}"));
        assertTrue(mapping.contains("inventoryPoolId: {type: string, format: uuid}"));
        var target = schemaSection(contract, "TargetRequest");
        assertTrue(target.contains("businessDate: {type: string, format: date}"));
        assertTrue(target.contains("exclusiveMinimum: 0"));
        assertTrue(target.contains("multipleOf: 0.01"));
        var pace = schemaSection(contract, "PaceCurveRequest");
        assertTrue(pace.contains("validFrom: {type: string, format: date}"));
        assertTrue(pace.contains("validUntil: {type: string, format: date, nullable: true}"));
        assertTrue(pace.contains("minItems: 2"));
        assertTrue(pace.contains("maxItems: 24"));
        var point = schemaSection(contract, "PacePointRequest");
        assertTrue(point.contains("cutoffLocalTime: {type: string, format: time}"));
        assertTrue(point.contains("minimum: 0"));
        assertTrue(point.contains("maximum: 100"));
    }

    @Test
    void exposesExecutionClockAndHourlyCutoffAsDifferentSimulationFields()
            throws IOException {
        var contract = contract();
        var simulationView = contract.substring(
                contract.indexOf("    SimulationRunView:"),
                contract.indexOf("    CommandRequest:"));
        assertTrue(simulationView.contains("- fixedClockAt"));
        assertTrue(simulationView.contains("- scheduledFor"));
        assertTrue(simulationView.contains("fixedClockAt:"));
        assertTrue(simulationView.contains("scheduledFor:"));

        var view = new Sprint1ApiDtos.SimulationRunView(
                java.util.UUID.randomUUID(),
                Sprint1ApiDtos.SimulationScenarioCode.BASELINE,
                "QUEUED",
                Instant.parse("2026-07-19T10:06:00Z"),
                Instant.parse("2026-07-19T10:00:00Z"),
                Optional.empty(),
                Optional.empty(),
                Optional.empty(),
                java.util.List.of(),
                0);
        assertEquals(Instant.parse("2026-07-19T10:06:00Z"),
                view.fixedClockAt());
        assertEquals(Instant.parse("2026-07-19T10:00:00Z"),
                view.scheduledFor());
    }

    @Test
    void exposesOriginalAndAdjustmentBriefVersionProvenance()
            throws IOException {
        var contract = contract();
        var briefView = contract.substring(
                contract.indexOf("    BriefView:"),
                contract.indexOf("    CommandRequest:"));

        assertTrue(briefView.contains("- completenessCode"));
        assertTrue(briefView.contains("- publishedAt"));
        assertTrue(briefView.contains("- simulationRunId"));
        assertTrue(briefView.contains("adjustment_id for a later version"));
        assertTrue(briefView.contains("maxLength: 12000"));
    }

    @Test
    void responseSecretSchemaExposesStatusAndFingerprintOnly() throws IOException {
        var contract = contract();
        var secretSchema = contract.substring(contract.indexOf("    SecretStatus:"));
        assertTrue(secretSchema.contains("configured:"));
        assertTrue(secretSchema.contains("fingerprint:"));
        assertTrue(secretSchema.contains("authorizationStatus:"));
        assertTrue(secretSchema.contains("lastCheckedAt:"));
        assertTrue(!secretSchema.contains("secretReference:"));
    }

    private static String contract() throws IOException {
        try (var stream = Sprint1OpenApiContractTest.class.getClassLoader()
                .getResourceAsStream(RESOURCE)) {
            assertNotNull(stream, RESOURCE + " must be packaged");
            return new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String pathSection(String contract, String path) {
        String marker = "  " + path + ":";
        int start = contract.indexOf(marker);
        assertTrue(start >= 0, path + " must exist");
        int end = contract.indexOf("\n  /api/v1/", start + marker.length());
        if (end < 0) {
            end = contract.indexOf("\ncomponents:", start + marker.length());
        }
        return contract.substring(start, end);
    }

    private static String schemaSection(String contract, String schemaName) {
        String marker = "    " + schemaName + ":";
        int start = contract.indexOf(marker);
        assertTrue(start >= 0, schemaName + " must exist");
        var nextSchema = Pattern.compile("(?m)^    [A-Z][A-Za-z0-9]+:$")
                .matcher(contract);
        assertTrue(nextSchema.find(start + marker.length()),
                schemaName + " must have a following schema");
        return contract.substring(start, nextSchema.start());
    }
}
