package cn.sifangguan.ota.worker.simulation.persistence;

import cn.sifangguan.ota.api.sprint1.adapter.JdbcSprint1ControlPlanePort;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Mutations;
import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.Sprint1TenantCommand;
import cn.sifangguan.ota.api.tenancy.TenantConfigurationCommandHandler;
import cn.sifangguan.ota.contracts.connector.SourceConnector;
import cn.sifangguan.ota.worker.filefixture.BuiltInOfficialExportParser;
import cn.sifangguan.ota.worker.filefixture.FileFixtureConnector;
import cn.sifangguan.ota.worker.job.CollectionJobPoller;
import cn.sifangguan.ota.worker.job.JdbcCollectionJobRepository;
import cn.sifangguan.ota.worker.job.RegisteredConnectorJobExecutor;
import cn.sifangguan.ota.worker.job.WorkerIdentity;
import cn.sifangguan.ota.worker.registry.SourceConnectorRegistry;
import cn.sifangguan.ota.worker.simulation.connector.SimulationCtripConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationMeituanConnector;
import cn.sifangguan.ota.worker.simulation.connector.SimulationPmsConnector;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;
import cn.sifangguan.ota.worker.simulation.pipeline.DeterministicSimulationPipeline;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunCommand;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationRunResult;
import cn.sifangguan.ota.worker.simulation.pipeline.SimulationScenarioCode;
import cn.sifangguan.ota.worker.sprint2.contract.RuntimeConnectorContractGuard;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultSafetyGate;
import cn.sifangguan.ota.worker.sprint2.validation.CollectionResultValidator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.support.TransactionTemplate;

import javax.sql.DataSource;
import java.io.IOException;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Conditional, disposable-database proof of the Sprint 1 simulation seam:
 * API command persistence -> Worker claim/pipeline/persistence -> API read
 * model. The connector registry contains only deterministic in-process
 * fixtures, and every notification remains DELIVERY_BLOCKED.
 */
class Sprint1RealPostgresClosedLoopIntegrationTest {
    private static final Instant EXECUTION_AT =
            Instant.parse("2026-07-19T10:06:00Z");
    private static final Instant CUTOFF_AT =
            Instant.parse("2026-07-19T10:00:00Z");
    private static final UUID PLATFORM_ADMIN_ROLE_ID =
            UUID.fromString("10000000-0000-4000-8000-000000000001");

    @Test
    @Timeout(value = 90, unit = TimeUnit.SECONDS)
    void apiWorkerApiClosedLoopRunsFiveScenariosWithoutExternalDelivery()
            throws Exception {
        Assumptions.assumeTrue(
                "isolated-database".equals(System.getenv("OTA_POSTGRES_IT_CONFIRM")),
                "Use only the disposable PostgreSQL runner");

        String adminUrl = required("OTA_POSTGRES_IT_ADMIN_URL");
        String adminUsername = required("OTA_POSTGRES_IT_ADMIN_USERNAME");
        String adminPassword = required("OTA_POSTGRES_IT_ADMIN_PASSWORD");
        String migrationUrl = required("OTA_POSTGRES_IT_MIGRATION_URL");
        String migrationUsername = required("OTA_POSTGRES_IT_MIGRATION_USERNAME");
        String migrationPassword = required("OTA_POSTGRES_IT_MIGRATION_PASSWORD");
        Path repositoryRoot = Path.of(
                required("OTA_POSTGRES_IT_REPOSITORY_ROOT")).toAbsolutePath().normalize();

        Flyway.configure()
                .dataSource(migrationUrl, migrationUsername, migrationPassword)
                .locations("classpath:db/migration")
                .defaultSchema("flyway")
                .schemas("flyway")
                .validateMigrationNaming(true)
                .cleanDisabled(true)
                .load()
                .migrate();

        RuntimeRoles roles = RuntimeRoles.random();
        UUID actorAccountId = UUID.randomUUID();
        UUID workerPrincipalId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        UUID hotelId = UUID.randomUUID();
        UUID secondDispatchTenantId = UUID.randomUUID();
        UUID secondDispatchHotelId = UUID.randomUUID();
        Set<String> createdRoles = new LinkedHashSet<>();

        try {
            createRuntimeRoles(
                    adminUrl, adminUsername, adminPassword, roles, createdRoles);
            seedWorkloadIdentities(
                    migrationUrl,
                    migrationUsername,
                    migrationPassword,
                    actorAccountId,
                    workerPrincipalId);
            applyRuntimeGrantMatrix(
                    migrationUrl,
                    migrationUsername,
                    migrationPassword,
                    repositoryRoot.resolve(
                            "database/ota-migrations/post-migration-grants.sql"),
                    roles,
                    workerPrincipalId,
                    "BLUE");

            DataSource apiDataSource = dataSource(
                    migrationUrl, roles.apiRole(), roles.apiPassword());
            DataSource workerDataSource = dataSource(
                    migrationUrl, roles.workerRole(), roles.workerPassword());
            JdbcTemplate apiJdbc = new JdbcTemplate(apiDataSource);
            JdbcTemplate workerJdbc = new JdbcTemplate(workerDataSource);
            TransactionTemplate apiTransactions = transactionTemplate(apiDataSource);
            TransactionTemplate workerTransactions =
                    transactionTemplate(workerDataSource);
            ObjectMapper objectMapper = new ObjectMapper().findAndRegisterModules();
            JdbcSprint1ControlPlanePort api = new JdbcSprint1ControlPlanePort(
                    apiJdbc,
                    objectMapper,
                    Clock.fixed(EXECUTION_AT, ZoneOffset.UTC));
            JdbcSimulationJobRepository worker = new JdbcSimulationJobRepository(
                    workerJdbc, workerTransactions, objectMapper);

            // This proves both the expected claim-function signature and that
            // the Worker connects as a non-owner, NOBYPASSRLS runtime role.
            new SimulationDatabaseSafetyVerifier(
                    workerJdbc,
                    workerPrincipalId).verify();

            initializeSimulationHotel(
                    api,
                    apiTransactions,
                    apiJdbc,
                    actorAccountId,
                    tenantId,
                    hotelId);
            addFileFixtureConnector(
                    api,
                    apiTransactions,
                    apiJdbc,
                    actorAccountId,
                    tenantId,
                    hotelId);
            addExactMinuteNormalSchedule(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    hotelId);
            initializeSimulationHotel(
                    api,
                    apiTransactions,
                    apiJdbc,
                    actorAccountId,
                    secondDispatchTenantId,
                    secondDispatchHotelId);
            addFileFixtureConnector(
                    api,
                    apiTransactions,
                    apiJdbc,
                    actorAccountId,
                    secondDispatchTenantId,
                    secondDispatchHotelId);
            addExactMinuteNormalSchedule(
                    apiTransactions,
                    apiJdbc,
                    secondDispatchTenantId,
                    secondDispatchHotelId);
            assertCrossTenantScheduleWriteRejected(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    secondDispatchTenantId,
                    secondDispatchHotelId);
            JdbcDynamicSchedulePort dynamicSchedules =
                    new JdbcDynamicSchedulePort(workerJdbc);
            assertThat(dynamicSchedules.dispatchDue(
                    workerPrincipalId,
                    EXECUTION_AT.plus(Duration.ofMinutes(54)).plusSeconds(1),
                    100)).isEqualTo(26);
            assertThat(dynamicSchedules.dispatchDue(
                    workerPrincipalId,
                    EXECUTION_AT.plus(Duration.ofMinutes(54)).plusSeconds(1),
                    100)).isZero();

            SourceConnectorRegistry connectorRegistry = connectorRegistry();
            var resultSafetyGate = new CollectionResultSafetyGate(
                    connectorRegistry,
                    new CollectionResultValidator(),
                    new RuntimeConnectorContractGuard(connectorRegistry));
            JdbcCollectionJobRepository collectionRepository =
                    new JdbcCollectionJobRepository(
                            workerJdbc,
                            workerTransactions,
                            objectMapper,
                            resultSafetyGate);
            try (CollectionJobPoller collectionPoller = new CollectionJobPoller(
                        collectionRepository,
                        collectionRepository,
                        new RegisteredConnectorJobExecutor(
                                connectorRegistry,
                                Clock.fixed(
                                        EXECUTION_AT.plus(Duration.ofHours(1)),
                                        ZoneOffset.UTC)),
                        new WorkerIdentity(workerPrincipalId.toString()),
                        Clock.fixed(
                                EXECUTION_AT.plus(Duration.ofHours(1)),
                                ZoneOffset.UTC))) {
                for (int index = 0; index < 26; index++) {
                    collectionPoller.pollOnce();
                }
                collectionPoller.pollOnce();
            }
            assertOrdinaryCollectionControlEvidence(
                    workerTransactions,
                    workerJdbc,
                    tenantId,
                    hotelId,
                    13);
            assertOrdinaryCollectionControlEvidence(
                    workerTransactions,
                    workerJdbc,
                    secondDispatchTenantId,
                    secondDispatchHotelId,
                    13);

            DeterministicSimulationPipeline pipeline =
                    new DeterministicSimulationPipeline(
                            connectorRegistry,
                            Clock.fixed(EXECUTION_AT, ZoneOffset.UTC));
            List<RunEvidence> evidence = new ArrayList<>();
            evidence.add(executeRun(
                    api, apiTransactions, apiJdbc, worker, pipeline,
                    actorAccountId, workerPrincipalId, tenantId, hotelId,
                    "it-baseline-1", SimulationScenarioCode.BASELINE, 0));
            evidence.add(executeRun(
                    api, apiTransactions, apiJdbc, worker, pipeline,
                    actorAccountId, workerPrincipalId, tenantId, hotelId,
                    "it-baseline-2", SimulationScenarioCode.BASELINE, 1));
            evidence.add(executeRun(
                    api, apiTransactions, apiJdbc, worker, pipeline,
                    actorAccountId, workerPrincipalId, tenantId, hotelId,
                    "it-late-replay", SimulationScenarioCode.LATE_BRIEF_REPLAY, 2));
            evidence.add(executeRun(
                    api, apiTransactions, apiJdbc, worker, pipeline,
                    actorAccountId, workerPrincipalId, tenantId, hotelId,
                    "it-inventory-mismatch",
                    SimulationScenarioCode.INVENTORY_MISMATCH, 3));

            Sprint1Views.MonitorView mismatchMonitor = tenantRead(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    () -> api.findMonitor(tenantId, hotelId).orElseThrow());
            assertThat(mismatchMonitor.inventory())
                    .anyMatch(item -> item.state().equals("P1_RISK"));
            assertThat(tenantRead(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    () -> api.listIncidents(hotelId, 20)))
                    .hasSize(2)
                    .allMatch(incident -> incident.type().equals(
                            "INVENTORY_MISMATCH"));

            evidence.add(executeRun(
                    api, apiTransactions, apiJdbc, worker, pipeline,
                    actorAccountId, workerPrincipalId, tenantId, hotelId,
                    "it-source-unavailable",
                    SimulationScenarioCode.SOURCE_UNAVAILABLE, 4));

            assertThat(evidence)
                    .extracting(value -> value.view().status())
                    .containsOnly("SUCCEEDED");
            assertThat(evidence)
                    .extracting(value -> value.view().fixedClockAt())
                    .containsOnly(EXECUTION_AT);
            assertThat(evidence)
                    .extracting(value -> value.view().scheduledFor())
                    .containsOnly(CUTOFF_AT);
            assertThat(evidence)
                    .extracting(value -> value.view().runId())
                    .doesNotHaveDuplicates();
            assertThat(evidence.get(0).result().scenarioCode())
                    .isEqualTo(SimulationScenarioCode.BASELINE);
            assertThat(evidence.get(1).result().scenarioCode())
                    .isEqualTo(SimulationScenarioCode.BASELINE);

            Sprint1Views.MonitorView monitor = tenantRead(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    () -> api.findMonitor(tenantId, hotelId).orElseThrow());
            assertThat(monitor.cutoffAt()).isEqualTo(CUTOFF_AT);
            assertThat(monitor.businessDate())
                    .isEqualTo(BuiltInSimulationFixture.BUSINESS_DATE);
            assertThat(monitor.completeness()).isEqualTo("PARTIAL");
            assertThat(monitor.sources())
                    .anyMatch(source -> source.sourceCode().equals("MEITUAN")
                            && source.completeness().equals("UNAVAILABLE"));
            assertMoney(
                    monitor.metrics().get("TOTAL_REVENUE").value(),
                    "7849.0000");

            List<Sprint1Views.BriefView> briefs = tenantRead(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    () -> api.listBriefs(hotelId, 20));
            assertThat(briefs).hasSize(5);
            assertThat(briefs)
                    .extracting(Sprint1Views.BriefView::simulationRunId)
                    .containsExactlyInAnyOrderElementsOf(
                            evidence.stream()
                                    .map(value -> value.view().runId())
                                    .toList());
            assertThat(briefs)
                    .allMatch(brief -> brief.deliveryStatus().equals("SIMULATED"))
                    .allMatch(Sprint1Views.BriefView::simulationMode)
                    .allMatch(brief -> brief.content().contains("间夜"))
                    .anyMatch(brief -> brief.content().contains("7849.00"))
                    .anyMatch(brief -> brief.content().contains("今日已售｜39间"));

            List<Sprint1Views.OutboxPreview> outbox = tenantRead(
                    apiTransactions,
                    apiJdbc,
                    tenantId,
                    () -> api.listOutboxPreview(hotelId, 50));
            assertThat(outbox).hasSize(7);
            assertThat(outbox)
                    .allMatch(Sprint1Views.OutboxPreview::deliveryBlocked)
                    .allMatch(item -> item.deliveryStatus().equals("SIMULATED"))
                    .allMatch(item -> item.bodyPreview().contains(
                            "DELIVERY_BLOCKED"))
                    .anyMatch(item -> item.messageKey().endsWith(
                            ":late-replay:1")
                            && item.bodyPreview().contains("过时简报补发"))
                    .anyMatch(item -> item.messageType().equals(
                            "P1_ALERT"));

            assertOutboundDeliveryRemainsImpossible(
                    adminUrl,
                    adminUsername,
                    adminPassword,
                    tenantId,
                    hotelId,
                    evidence.size(),
                    outbox.size());
            assertSprint2cContractGovernanceAndPrincipalRotation(
                    adminUrl,
                    adminUsername,
                    adminPassword,
                    migrationUrl,
                    migrationUsername,
                    migrationPassword,
                    repositoryRoot.resolve(
                            "database/ota-migrations/post-migration-grants.sql"),
                    roles,
                    actorAccountId,
                    workerPrincipalId,
                    tenantId,
                    hotelId,
                    apiTransactions,
                    apiJdbc,
                    workerDataSource,
                    workerJdbc,
                    workerTransactions,
                    createdRoles);
        } finally {
            dropRuntimeRoles(
                    adminUrl,
                    adminUsername,
                    adminPassword,
                    createdRoles);
        }
    }

    private static void assertSprint2cContractGovernanceAndPrincipalRotation(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            String migrationUrl,
            String migrationUsername,
            String migrationPassword,
            Path grantScript,
            RuntimeRoles roles,
            UUID actorAccountId,
            UUID bluePrincipalId,
            UUID tenantId,
            UUID hotelId,
            TransactionTemplate apiTransactions,
            JdbcTemplate apiJdbc,
            DataSource blueDataSource,
            JdbcTemplate blueJdbc,
            TransactionTemplate blueTransactions,
            Set<String> createdRoles) throws Exception {
        DataSource roleAdminDataSource =
                dataSource(adminUrl, adminUsername, adminPassword);
        JdbcTemplate roleAdminJdbc = new JdbcTemplate(roleAdminDataSource);
        DataSource adminDataSource =
                dataSource(migrationUrl, migrationUsername, migrationPassword);
        JdbcTemplate adminJdbc = new JdbcTemplate(adminDataSource);
        TransactionTemplate adminTransactions =
                transactionTemplate(adminDataSource);
        UUID connectorId = stableId("it-pms|" + hotelId);
        Map<String, Object> connectorVersion = tenantRead(
                adminTransactions,
                adminJdbc,
                tenantId,
                () -> adminJdbc.queryForMap("""
                        select connector.connector_id,
                               version.connector_version_id,
                               connector.adapter_code,
                               version.adapter_version,
                               version.config_hash
                          from ota.hotel_source_connector connector
                          join ota.hotel_source_connector_version version
                            on version.tenant_id = connector.tenant_id
                           and version.hotel_id = connector.hotel_id
                           and version.connector_id = connector.connector_id
                         where connector.tenant_id = ?
                           and connector.hotel_id = ?
                           and connector.connector_id = ?
                           and version.status = 'ACTIVE'
                        """, tenantId, hotelId, connectorId));
        UUID connectorVersionId =
                (UUID) connectorVersion.get("connector_version_id");
        String adapterCode = (String) connectorVersion.get("adapter_code");
        String adapterVersion =
                (String) connectorVersion.get("adapter_version");
        String originalConfigHash =
                (String) connectorVersion.get("config_hash");
        String streamCode = "PMS_OPERATING";
        UUID candidateId = UUID.randomUUID();
        UUID baselineId = UUID.randomUUID();
        UUID authSessionId = UUID.randomUUID();

        assertThat(adminJdbc.queryForObject(
                "select count(*) from control.connector_contract_candidate_manifest",
                Integer.class)).isZero();
        assertThat(readEffectiveContract(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                streamCode)).isEmpty();

        for (String protectedTable : List.of(
                "control.connector_contract_candidate_manifest",
                "ota.connector_contract_approved_baseline",
                "ota.connector_contract_baseline_revocation",
                "ota.connector_contract_command_receipt")) {
            assertSqlState("42501", () -> apiJdbc.queryForObject(
                    "select count(*) from " + protectedTable,
                    Integer.class));
            assertSqlState("42501", () -> blueJdbc.queryForObject(
                    "select count(*) from " + protectedTable,
                    Integer.class));
            assertSqlState("42501", () -> blueJdbc.update(
                    "insert into " + protectedTable + " default values"));
        }
        assertSqlState("23514", () -> tenantWrite(
                apiTransactions,
                apiJdbc,
                tenantId,
                () -> apiJdbc.update("""
                        update ota.hotel
                           set message_enabled = true
                         where tenant_id = ?
                           and hotel_id = ?
                        """, tenantId, hotelId)));

        TransactionTemplate repeatableRead =
                transactionTemplate(blueDataSource);
        repeatableRead.setIsolationLevel(Connection.TRANSACTION_REPEATABLE_READ);
        assertSqlState("42501", () -> visibleHotelCount(
                repeatableRead,
                blueJdbc,
                tenantId,
                hotelId));
        assertSqlState("42501", () -> noOpAuthorizationStateUpdate(
                repeatableRead,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId));
        assertRoleRenameFailsClosed(
                roleAdminJdbc,
                migrationUrl,
                roles.workerRole(),
                roles.workerPassword(),
                tenantId,
                hotelId);
        assertMembershipEdgesFailClosed(
                roleAdminJdbc,
                migrationUrl,
                roles.workerRole(),
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                createdRoles);

        assertSqlState("42501", () -> apiJdbc.update("""
                insert into control.connector_contract_candidate_manifest(
                    candidate_id, connector_code, adapter_code,
                    adapter_version, stream_code, capability_fingerprint,
                    schema_fingerprint, artifact_digest, source_revision
                ) values (?, 'UNTRUSTED_API', ?, ?, ?, ?, ?, ?, 'api-write')
                """,
                UUID.randomUUID(),
                adapterCode,
                adapterVersion,
                streamCode,
                sha256("api-capability"),
                sha256("api-schema"),
                sha256("api-artifact")));
        assertSqlState("42501", () -> blueJdbc.update("""
                insert into control.connector_contract_candidate_manifest(
                    candidate_id, connector_code, adapter_code,
                    adapter_version, stream_code, capability_fingerprint,
                    schema_fingerprint, artifact_digest, source_revision
                ) values (?, 'UNTRUSTED_WORKER', ?, ?, ?, ?, ?, ?, 'worker-write')
                """,
                UUID.randomUUID(),
                adapterCode,
                adapterVersion,
                streamCode,
                sha256("worker-capability"),
                sha256("worker-schema"),
                sha256("worker-artifact")));

        adminJdbc.update("""
                insert into control.connector_contract_candidate_manifest(
                    candidate_id, connector_code, adapter_code,
                    adapter_version, stream_code, capability_fingerprint,
                    schema_fingerprint, artifact_digest, source_revision
                ) values (?, ?, ?, ?, ?, ?, ?, ?, 'trusted-it-build')
                """,
                candidateId,
                adapterCode,
                adapterCode,
                adapterVersion,
                streamCode,
                sha256("trusted-capability"),
                sha256("trusted-schema"),
                sha256("trusted-artifact"));
        adminJdbc.update("""
                insert into control.auth_session(
                    session_id, account_id, session_family_id,
                    refresh_token_hash, authz_version_snapshot,
                    issued_at, expires_at
                ) values (?, ?, ?, ?, 1, current_timestamp - interval '1 minute',
                          current_timestamp + interval '1 hour')
                """,
                authSessionId,
                actorAccountId,
                UUID.randomUUID(),
                sha256("contract-admin-session|" + authSessionId));

        assertSqlState("42501", () -> apiJdbc.queryForList("""
                select * from control.approve_connector_contract_candidate(
                    ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'IT_APPROVAL')
                """,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                candidateId,
                baselineId,
                streamCode,
                UUID.randomUUID(),
                "api-approve-denied",
                sha256("api-approve-denied")));
        assertSqlState("42501", () -> blueJdbc.queryForList("""
                select * from control.revoke_connector_contract_baseline(
                    ?, ?, ?, ?, 1, ?, ?, ?, 'IT_REVOKE')
                """,
                tenantId,
                hotelId,
                baselineId,
                UUID.randomUUID(),
                UUID.randomUUID(),
                "worker-revoke-denied",
                sha256("worker-revoke-denied")));

        List<Map<String, Object>> approval = adminTransactions.execute(status -> {
            setAuthenticatedTenantContext(
                    adminJdbc,
                    tenantId,
                    actorAccountId,
                    authSessionId);
            return adminJdbc.queryForList("""
                    select * from control.approve_connector_contract_candidate(
                        ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'IT_APPROVAL')
                    """,
                    tenantId,
                    hotelId,
                    connectorId,
                    connectorVersionId,
                    candidateId,
                    baselineId,
                    streamCode,
                    UUID.randomUUID(),
                    "it-contract-approve-" + shortId(baselineId),
                    sha256("it-contract-approve|" + baselineId));
        });
        assertThat(approval).singleElement()
                .extracting(row -> row.get("approval_status"))
                .isEqualTo("APPROVED");

        List<Map<String, Object>> approvedProjection = readEffectiveContract(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                streamCode);
        assertThat(approvedProjection).singleElement()
                .satisfies(row -> {
                    assertThat(row).containsOnlyKeys(
                            "connector_code",
                            "adapter_version",
                            "fingerprint_algorithm",
                            "capability_fingerprint",
                            "schema_fingerprint",
                            "approval_status",
                            "connector_version_status");
                    assertThat(row.get("approval_status")).isEqualTo("APPROVED");
                    assertThat(row.get("connector_version_status"))
                            .isEqualTo("ACTIVE");
        });

        String driftedConfigHash = sha256("drift|" + connectorVersionId);
        tenantWrite(
                adminTransactions,
                adminJdbc,
                tenantId,
                () -> adminJdbc.update("""
                        update ota.hotel_source_connector_version
                           set config_hash = ?
                         where tenant_id = ?
                           and hotel_id = ?
                           and connector_id = ?
                           and connector_version_id = ?
                        """,
                        driftedConfigHash,
                        tenantId,
                        hotelId,
                        connectorId,
                        connectorVersionId));
        assertThat(readEffectiveContract(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                streamCode)).singleElement()
                .extracting(row -> row.get("approval_status"))
                .isEqualTo("REVOKED");
        tenantWrite(
                adminTransactions,
                adminJdbc,
                tenantId,
                () -> adminJdbc.update("""
                        update ota.hotel_source_connector_version
                           set config_hash = ?
                         where tenant_id = ?
                           and hotel_id = ?
                           and connector_id = ?
                           and connector_version_id = ?
                        """,
                        originalConfigHash,
                        tenantId,
                        hotelId,
                        connectorId,
                        connectorVersionId));

        UUID revocationId = UUID.randomUUID();
        List<Map<String, Object>> revocation = adminTransactions.execute(status -> {
            setAuthenticatedTenantContext(
                    adminJdbc,
                    tenantId,
                    actorAccountId,
                    authSessionId);
            return adminJdbc.queryForList("""
                    select * from control.revoke_connector_contract_baseline(
                        ?, ?, ?, ?, 1, ?, ?, ?, 'IT_REVOKE')
                    """,
                    tenantId,
                    hotelId,
                    baselineId,
                    revocationId,
                    UUID.randomUUID(),
                    "it-contract-revoke-" + shortId(baselineId),
                    sha256("it-contract-revoke|" + baselineId));
        });
        assertThat(revocation).singleElement()
                .extracting(row -> row.get("approval_status"))
                .isEqualTo("REVOKED");
        assertThat(readEffectiveContract(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                streamCode)).singleElement()
                .extracting(row -> row.get("approval_status"))
                .isEqualTo("REVOKED");

        UUID greenPrincipalId = UUID.randomUUID();
        String greenRole = "ota_it_worker_green_" + randomHex(8);
        String greenPassword = randomHex(24);
        createWorkerRotationIdentity(
                roleAdminJdbc,
                adminJdbc,
                greenPrincipalId,
                greenRole,
                greenPassword,
                createdRoles);
        RuntimeRoles greenGrantRoles = new RuntimeRoles(
                roles.apiRole(),
                roles.apiPassword(),
                greenRole,
                greenPassword,
                roles.auditRole(),
                roles.auditPassword());
        applyRuntimeGrantMatrix(
                migrationUrl,
                migrationUsername,
                migrationPassword,
                grantScript,
                greenGrantRoles,
                greenPrincipalId,
                "GREEN");
        DataSource greenDataSource =
                dataSource(migrationUrl, greenRole, greenPassword);
        JdbcTemplate greenJdbc = new JdbcTemplate(greenDataSource);
        TransactionTemplate greenTransactions =
                transactionTemplate(greenDataSource);

        assertThat(bindingState(adminJdbc, greenPrincipalId))
                .isEqualTo("STAGED");
        assertSqlState("42501", () -> visibleHotelCount(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId));
        assertSqlState("42501", () -> noOpAuthorizationStateUpdate(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId,
                connectorId));

        LeasedJob drainingCompletionLease = createAndClaimRotationLease(
                adminTransactions,
                adminJdbc,
                blueJdbc,
                bluePrincipalId,
                tenantId,
                hotelId,
                connectorId);
        assertThat(blueJdbc.queryForObject("""
                select control.renew_ota_job_lease(
                    ?, ?, ?, timestamptz '2099-01-01 00:00:00+00',
                    timestamptz '2099-01-01 00:07:00+00')
                """,
                Boolean.class,
                drainingCompletionLease.jobId(),
                drainingCompletionLease.leaseId(),
                bluePrincipalId)).isTrue();

        UUID rotationId = UUID.randomUUID();
        adminJdbc.queryForObject(
                "select control.promote_service_principal_binding(?, ?, ?, 'IT_PROMOTE')",
                Object.class,
                greenPrincipalId,
                bluePrincipalId,
                rotationId);
        assertThat(bindingState(adminJdbc, bluePrincipalId))
                .isEqualTo("DRAINING");
        assertThat(bindingState(adminJdbc, greenPrincipalId))
                .isEqualTo("ACTIVE");
        assertThat(visibleHotelCount(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId)).isEqualTo(1);
        assertThat(noOpAuthorizationStateUpdate(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId,
                connectorId)).isGreaterThanOrEqualTo(1);

        assertThat(visibleHotelCount(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId)).isEqualTo(1);
        assertSqlState("42501", () -> noOpAuthorizationStateUpdate(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId));
        assertSqlState("42501", () -> blueJdbc.queryForList("""
                select * from control.claim_ota_job(
                    ?, ?, ?, current_timestamp,
                    current_timestamp + interval '5 minutes',
                    'COLLECTION')
                """,
                bluePrincipalId,
                UUID.randomUUID(),
                UUID.randomUUID()));
        assertSqlState("42501", () -> blueJdbc.queryForList("""
                select * from control.dispatch_due_ota_jobs(
                    ?, current_timestamp, 10)
                """, bluePrincipalId));
        assertSqlState("42501", () -> blueJdbc.queryForObject("""
                select control.renew_ota_job_lease(
                    ?, ?, ?, current_timestamp,
                    current_timestamp + interval '5 minutes')
                """,
                Boolean.class,
                drainingCompletionLease.jobId(),
                drainingCompletionLease.leaseId(),
                bluePrincipalId));
        assertThat(blueJdbc.queryForObject("""
                select control.complete_ota_job(
                    ?, ?, ?, current_timestamp, 'SUCCEEDED', null)
                """,
                Boolean.class,
                drainingCompletionLease.jobId(),
                drainingCompletionLease.leaseId(),
                bluePrincipalId)).isTrue();
        assertThat(blueJdbc.queryForObject("""
                select control.complete_ota_job(
                    ?, ?, ?, timestamptz '2099-01-01 00:00:00+00',
                    'SUCCEEDED', null)
                """,
                Boolean.class,
                UUID.randomUUID(),
                UUID.randomUUID(),
                bluePrincipalId)).isFalse();

        adminJdbc.queryForObject(
                "select control.rollback_service_principal_promotion(?, ?, ?, 'IT_ROLLBACK')",
                Object.class,
                greenPrincipalId,
                bluePrincipalId,
                rotationId);
        assertThat(bindingState(adminJdbc, bluePrincipalId))
                .isEqualTo("ACTIVE");
        assertThat(bindingState(adminJdbc, greenPrincipalId))
                .isEqualTo("DRAINING");
        assertThat(visibleHotelCount(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId)).isEqualTo(1);
        assertSqlState("42501", () -> noOpAuthorizationStateUpdate(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId,
                connectorId));

        adminJdbc.queryForObject(
                "select control.retire_service_principal_binding(?, ?, ?, 'IT_RETIRE')",
                Object.class,
                greenPrincipalId,
                bluePrincipalId,
                rotationId);
        assertThat(bindingState(adminJdbc, greenPrincipalId))
                .isEqualTo("RETIRED");
        assertThat(adminJdbc.queryForObject("""
                select status
                  from control.service_principal
                 where service_principal_id = ?
                """, String.class, greenPrincipalId)).isEqualTo("DISABLED");
        assertSqlState("42501", () -> visibleHotelCount(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId));
        assertSqlState("42501", () -> noOpAuthorizationStateUpdate(
                greenTransactions,
                greenJdbc,
                tenantId,
                hotelId,
                connectorId));
        assertSqlState("42501", () -> greenJdbc.queryForObject("""
                select control.renew_ota_job_lease(
                    ?, ?, ?, current_timestamp,
                    current_timestamp + interval '5 minutes')
                """,
                Boolean.class,
                UUID.randomUUID(),
                UUID.randomUUID(),
                greenPrincipalId));

        roleAdminJdbc.execute("drop owned by " + greenRole);
        roleAdminJdbc.execute("drop role " + greenRole);
        createdRoles.remove(greenRole);
        assertThat(visibleHotelCount(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId)).isEqualTo(1);
        assertThat(noOpAuthorizationStateUpdate(
                blueTransactions,
                blueJdbc,
                tenantId,
                hotelId,
                connectorId)).isGreaterThanOrEqualTo(1);
        String reusedNamePassword = randomHex(24);
        roleAdminJdbc.execute(
                "create role " + greenRole
                        + " with login password '" + reusedNamePassword
                        + "' nosuperuser nocreatedb nocreaterole"
                        + " noinherit noreplication nobypassrls");
        createdRoles.add(greenRole);
        try {
            adminJdbc.execute(
                    "grant usage on schema control, ota to " + greenRole);
            adminJdbc.execute(
                    "grant execute on function control.current_tenant_id() to "
                            + greenRole);
            adminJdbc.execute("grant select on ota.hotel to " + greenRole);
            DataSource reusedNameDataSource =
                    dataSource(migrationUrl, greenRole, reusedNamePassword);
            assertSqlState("42501", () -> visibleHotelCount(
                    transactionTemplate(reusedNameDataSource),
                    new JdbcTemplate(reusedNameDataSource),
                    tenantId,
                    hotelId));
        } finally {
            roleAdminJdbc.execute("drop owned by " + greenRole);
            roleAdminJdbc.execute("drop role " + greenRole);
            createdRoles.remove(greenRole);
        }

        assertThat(adminJdbc.queryForObject("""
                select count(*)
                  from control.service_principal_rotation_event
                 where rotation_id = ?
                """, Integer.class, rotationId)).isEqualTo(5);

        UUID cancelledPrincipalId = UUID.randomUUID();
        String cancelledRole = "ota_it_worker_cancel_" + randomHex(8);
        String cancelledPassword = randomHex(24);
        createWorkerRotationIdentity(
                roleAdminJdbc,
                adminJdbc,
                cancelledPrincipalId,
                cancelledRole,
                cancelledPassword,
                createdRoles);
        RuntimeRoles cancelledGrantRoles = new RuntimeRoles(
                roles.apiRole(),
                roles.apiPassword(),
                cancelledRole,
                cancelledPassword,
                roles.auditRole(),
                roles.auditPassword());
        applyRuntimeGrantMatrix(
                migrationUrl,
                migrationUsername,
                migrationPassword,
                grantScript,
                cancelledGrantRoles,
                cancelledPrincipalId,
                "GREEN");
        assertThat(bindingState(adminJdbc, cancelledPrincipalId))
                .isEqualTo("STAGED");
        adminJdbc.queryForObject(
                "select control.cancel_staged_service_principal_binding(?, ?, 'IT_STAGE_CANCEL')",
                Object.class,
                cancelledPrincipalId,
                UUID.randomUUID());
        assertThat(bindingState(adminJdbc, cancelledPrincipalId))
                .isEqualTo("RETIRED");
        assertThat(adminJdbc.queryForObject("""
                select status
                  from control.service_principal
                 where service_principal_id = ?
                """, String.class, cancelledPrincipalId))
                .isEqualTo("DISABLED");

        assertThat(adminJdbc.queryForObject("""
                select count(*)
                  from control.service_principal_database_role_binding
                 where binding_scope = 'CONNECTOR_WORKER'
                   and binding_state in ('STAGED', 'DRAINING')
                """, Integer.class)).isZero();
        assertThat(adminJdbc.queryForObject("""
                select count(*)
                  from control.service_principal_database_role_binding
                 where binding_scope = 'CONNECTOR_WORKER'
                   and binding_state = 'ACTIVE'
                """, Integer.class)).isEqualTo(1);
        assertThat(adminJdbc.queryForObject("""
                select count(*)
                  from control.service_principal_database_role_binding binding
                 where binding.binding_state <> 'RETIRED'
                   and not exists (
                     select 1
                       from pg_catalog.pg_roles role
                      where role.oid = binding.database_role_oid
                        and role.rolname = binding.database_role_name
                  )
                """, Integer.class)).isZero();
    }

    private static void initializeSimulationHotel(
            JdbcSprint1ControlPlanePort api,
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID actorAccountId,
            UUID tenantId,
            UUID hotelId) {
        Sprint1Mutations.InitializeSimulationHotel initialization =
                new Sprint1Mutations.InitializeSimulationHotel(
                        tenantId,
                        hotelId,
                        stableId("it-pms|" + hotelId),
                        stableId("it-ctrip|" + hotelId),
                        stableId("it-meituan|" + hotelId),
                        "IT_TENANT_" + shortId(tenantId),
                        "Sprint 1 PostgreSQL IT Tenant",
                        "IT_HOTEL_" + shortId(hotelId),
                        "Sprint 1 PostgreSQL Closed Loop Hotel",
                        "Asia/Shanghai");
        Sprint1TenantCommand command = command(
                tenantId,
                actorAccountId,
                "it-initialize-" + shortId(hotelId),
                initialization);
        TenantConfigurationCommandHandler.CommandReceipt receipt = tenantWrite(
                transactions,
                jdbc,
                tenantId,
                () -> api.handle(command));
        assertThat(receipt.replayed()).isFalse();

        Sprint1Views.ConfigurationView configuration = tenantRead(
                transactions,
                jdbc,
                tenantId,
                () -> api.findConfiguration(tenantId, hotelId).orElseThrow());
        assertThat(configuration.simulationMode()).isTrue();
        assertThat(configuration.outboundDeliveryBlocked()).isTrue();
        assertThat(configuration.connectors()).hasSize(3);
        assertThat(configuration.inventoryPools()).hasSize(5);
    }

    private static List<Map<String, Object>> readEffectiveContract(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId,
            UUID connectorVersionId,
            String streamCode) {
        return tenantRead(transactions, jdbc, tenantId, () -> jdbc.queryForList("""
                select * from control.read_effective_connector_contract_baseline(
                    ?, ?, ?, ?, ?)
                """,
                tenantId,
                hotelId,
                connectorId,
                connectorVersionId,
                streamCode));
    }

    private static void setAuthenticatedTenantContext(
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID accountId,
            UUID authSessionId) {
        jdbc.queryForObject(
                "select set_config('app.tenant_id', ?, true)",
                String.class,
                tenantId.toString());
        jdbc.queryForObject(
                "select set_config('app.account_id', ?, true)",
                String.class,
                accountId.toString());
        jdbc.queryForObject(
                "select set_config('app.auth_session_id', ?, true)",
                String.class,
                authSessionId.toString());
    }

    private static void createWorkerRotationIdentity(
            JdbcTemplate roleAdminJdbc,
            JdbcTemplate migrationJdbc,
            UUID principalId,
            String databaseRole,
            String password,
            Set<String> createdRoles) {
        roleAdminJdbc.execute(
                "create role " + databaseRole
                        + " with login password '" + password
                        + "' nosuperuser nocreatedb nocreaterole"
                        + " noinherit noreplication nobypassrls");
        createdRoles.add(databaseRole);
        migrationJdbc.update("""
                insert into control.service_principal(
                    service_principal_id, principal_code, purpose, status
                ) values (?, ?, 'CONNECTOR_WORKER', 'ACTIVE')
                """,
                principalId,
                "OTA_SPRINT2C_ROTATION_" + shortId(principalId));
    }

    private static String bindingState(
            JdbcTemplate adminJdbc,
            UUID servicePrincipalId) {
        return adminJdbc.queryForObject("""
                select binding_state
                  from control.service_principal_database_role_binding
                 where service_principal_id = ?
                """, String.class, servicePrincipalId);
    }

    private static void assertRoleRenameFailsClosed(
            JdbcTemplate roleAdminJdbc,
            String databaseUrl,
            String workerRole,
            String workerPassword,
            UUID tenantId,
            UUID hotelId) throws SQLException {
        String renamedRole = workerRole + "_renamed";
        boolean renamed = false;
        try (Connection connection = DriverManager.getConnection(
                databaseUrl, workerRole, workerPassword)) {
            connection.setAutoCommit(false);
            try (PreparedStatement tenant = connection.prepareStatement(
                    "select set_config('app.tenant_id', ?, true)")) {
                tenant.setString(1, tenantId.toString());
                tenant.executeQuery().close();
            }
            roleAdminJdbc.execute(
                    "alter role " + workerRole + " rename to " + renamedRole);
            renamed = true;
            try (PreparedStatement read = connection.prepareStatement("""
                    select count(*)
                      from ota.hotel
                     where tenant_id = ?
                       and hotel_id = ?
                    """)) {
                read.setObject(1, tenantId);
                read.setObject(2, hotelId);
                try {
                    read.executeQuery().close();
                    throw new AssertionError(
                            "Renamed Worker role must fail the immutable OID/name gate");
                } catch (SQLException exception) {
                    assertThat(exception.getSQLState()).isEqualTo("42501");
                }
            }
            connection.rollback();
        } finally {
            if (renamed) {
                roleAdminJdbc.execute(
                        "alter role " + renamedRole + " rename to " + workerRole);
            }
        }
    }

    private static void assertMembershipEdgesFailClosed(
            JdbcTemplate roleAdminJdbc,
            String databaseUrl,
            String workerRole,
            TransactionTemplate workerTransactions,
            JdbcTemplate workerJdbc,
            UUID tenantId,
            UUID hotelId,
            Set<String> createdRoles) {
        String probeRole = "ota_it_membership_probe_" + randomHex(8);
        roleAdminJdbc.execute(
                "create role " + probeRole
                        + " nologin nosuperuser nocreatedb nocreaterole"
                        + " noinherit noreplication nobypassrls");
        createdRoles.add(probeRole);

        roleAdminJdbc.execute("grant " + probeRole + " to " + workerRole);
        try {
            assertSqlState("42501", () -> visibleHotelCount(
                    workerTransactions,
                    workerJdbc,
                    tenantId,
                    hotelId));
        } finally {
            roleAdminJdbc.execute("revoke " + probeRole + " from " + workerRole);
        }

        roleAdminJdbc.execute("grant " + workerRole + " to " + probeRole);
        try {
            assertSqlState("42501", () -> visibleHotelCount(
                    workerTransactions,
                    workerJdbc,
                    tenantId,
                    hotelId));
        } finally {
            roleAdminJdbc.execute("revoke " + workerRole + " from " + probeRole);
        }

        String delegateRole = "ota_it_delegate_probe_" + randomHex(8);
        String delegatePassword = randomHex(24);
        roleAdminJdbc.execute(
                "create role " + delegateRole
                        + " with login password '" + delegatePassword
                        + "' nosuperuser nocreatedb nocreaterole"
                        + " noinherit noreplication nobypassrls");
        createdRoles.add(delegateRole);
        roleAdminJdbc.execute("grant " + workerRole + " to " + delegateRole);
        try (Connection delegated = DriverManager.getConnection(
                databaseUrl, delegateRole, delegatePassword);
             Statement statement = delegated.createStatement()) {
            delegated.setAutoCommit(false);
            statement.execute("set role " + workerRole);
            try (PreparedStatement tenant = delegated.prepareStatement(
                    "select set_config('app.tenant_id', ?, true)")) {
                tenant.setString(1, tenantId.toString());
                tenant.executeQuery().close();
            }
            try (PreparedStatement read = delegated.prepareStatement("""
                    select count(*)
                      from ota.hotel
                     where tenant_id = ?
                       and hotel_id = ?
                    """)) {
                read.setObject(1, tenantId);
                read.setObject(2, hotelId);
                try {
                    read.executeQuery().close();
                    throw new AssertionError(
                            "Delegated SET ROLE must not impersonate the bound Worker");
                } catch (SQLException exception) {
                    assertThat(exception.getSQLState()).isEqualTo("42501");
                }
            }
            delegated.rollback();
        } catch (SQLException exception) {
            throw new IllegalStateException(exception);
        } finally {
            roleAdminJdbc.execute(
                    "revoke " + workerRole + " from " + delegateRole);
        }
        assertThat(visibleHotelCount(
                workerTransactions,
                workerJdbc,
                tenantId,
                hotelId)).isEqualTo(1);
    }

    private static LeasedJob createAndClaimRotationLease(
            TransactionTemplate migrationTransactions,
            JdbcTemplate migrationJdbc,
            JdbcTemplate workerJdbc,
            UUID workerPrincipalId,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId) {
        Map<String, Object> schedule = tenantRead(
                migrationTransactions,
                migrationJdbc,
                tenantId,
                () -> migrationJdbc.queryForMap("""
                        select schedule_id, stream_code, trigger_type
                          from ota.connector_collection_schedule
                         where tenant_id = ?
                           and hotel_id = ?
                           and connector_id = ?
                           and stream_code <> 'SIMULATION_PIPELINE'
                         order by schedule_id
                         limit 1
                        """, tenantId, hotelId, connectorId));
        UUID jobId = UUID.randomUUID();
        UUID leaseId = UUID.randomUUID();
        UUID runId = UUID.randomUUID();
        migrationJdbc.update("""
                insert into control.ota_job_registry(
                    job_id, tenant_id, hotel_id, connector_id, schedule_id,
                    simulation_run_id, job_type, stream_code, trigger_type,
                    scheduled_for, available_at, priority_no
                ) values (
                    ?, ?, ?, ?, ?, null, 'COLLECTION', ?, ?,
                    date_trunc('hour', clock_timestamp() - interval '3650 days'),
                    date_trunc('hour', clock_timestamp() - interval '3650 days'),
                    1
                )
                """,
                jobId,
                tenantId,
                hotelId,
                connectorId,
                schedule.get("schedule_id"),
                schedule.get("stream_code"),
                schedule.get("trigger_type"));
        List<Map<String, Object>> claimed = workerJdbc.queryForList("""
                select claim.*,
                       extract(
                           epoch from claim.lease_expires_at - clock_timestamp()
                       ) as database_lease_seconds
                  from control.claim_ota_job(
                      ?, ?, ?,
                      timestamptz '2099-01-01 00:00:00+00',
                      timestamptz '2099-01-01 00:05:00+00',
                      'COLLECTION'
                  ) as claim
                """, workerPrincipalId, leaseId, runId);
        assertThat(claimed).singleElement().satisfies(row -> {
            assertThat(row.get("job_id")).isEqualTo(jobId);
            assertThat(((Number) row.get("database_lease_seconds")).doubleValue())
                    .isBetween(240.0, 305.0);
        });
        return new LeasedJob(jobId, leaseId);
    }

    private static int noOpAuthorizationStateUpdate(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID hotelId,
            UUID connectorId) {
        Integer updated = tenantWrite(
                transactions,
                jdbc,
                tenantId,
                () -> jdbc.update("""
                        update ota.connector_authorization_state
                           set row_version = row_version
                         where tenant_id = ?
                           and hotel_id = ?
                           and connector_id = ?
                        """, tenantId, hotelId, connectorId));
        return updated == null ? 0 : updated;
    }

    private static int visibleHotelCount(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID hotelId) {
        Integer count = tenantRead(
                transactions,
                jdbc,
                tenantId,
                () -> jdbc.queryForObject("""
                        select count(*)
                          from ota.hotel
                         where tenant_id = ?
                           and hotel_id = ?
                        """, Integer.class, tenantId, hotelId));
        return count == null ? 0 : count;
    }

    private static void assertSqlState(String expectedSqlState, Runnable action) {
        try {
            action.run();
        } catch (RuntimeException exception) {
            Throwable cause = exception;
            while (cause.getCause() != null) {
                cause = cause.getCause();
            }
            assertThat(cause).isInstanceOf(SQLException.class);
            assertThat(((SQLException) cause).getSQLState())
                    .isEqualTo(expectedSqlState);
            return;
        }
        throw new AssertionError(
                "Expected PostgreSQL SQLSTATE " + expectedSqlState);
    }

    private static void addFileFixtureConnector(
            JdbcSprint1ControlPlanePort api,
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID actorAccountId,
            UUID tenantId,
            UUID hotelId) {
        Sprint1Mutations.UpsertConnector connector =
                new Sprint1Mutations.UpsertConnector(
                        hotelId,
                        stableId("it-file-fixture|" + hotelId),
                        "FILE_FIXTURE",
                        "OFFICIAL_EXPORT",
                        true,
                        "BASELINE",
                        60,
                        null);
        tenantWrite(
                transactions,
                jdbc,
                tenantId,
                () -> api.handle(command(
                        tenantId,
                        actorAccountId,
                        "it-file-fixture-" + shortId(hotelId),
                        connector)));

        Sprint1Views.ConfigurationView configuration = tenantRead(
                transactions,
                jdbc,
                tenantId,
                () -> api.findConfiguration(tenantId, hotelId).orElseThrow());
        assertThat(configuration.connectors())
                .anyMatch(item -> item.adapterCode().equals("FILE_FIXTURE")
                        && item.sourceCode().equals("OFFICIAL_EXPORT"));
    }

    private static void addExactMinuteNormalSchedule(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID hotelId) {
        UUID connectorId = stableId("it-file-fixture|" + hotelId);
        tenantWrite(transactions, jdbc, tenantId, () -> jdbc.update("""
                insert into ota.connector_collection_schedule(
                    tenant_id, hotel_id, connector_id, schedule_id,
                    stream_code, trigger_type, interval_minutes,
                    timeout_seconds, lookback_minutes, priority_no,
                    next_due_at, enabled
                ) values (?, ?, ?, ?, 'BOOKING_EVENT', 'NORMAL',
                          5, 240, 120, 1, ?, true)
                """,
                tenantId,
                hotelId,
                connectorId,
                stableId(
                        "it-exact-minute-normal|"
                                + tenantId + "|" + hotelId),
                Timestamp.from(Instant.parse("2026-07-19T10:05:00Z"))));
    }

    private static void assertCrossTenantScheduleWriteRejected(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID contextTenantId,
            UUID targetTenantId,
            UUID targetHotelId) {
        UUID scheduleId = stableId(
                "it-cross-tenant-schedule|" + targetTenantId);
        assertSqlState("55000", () -> tenantWrite(
                transactions,
                jdbc,
                contextTenantId,
                () -> jdbc.update("""
                        insert into ota.connector_collection_schedule(
                            tenant_id, hotel_id, connector_id, schedule_id,
                            stream_code, trigger_type, interval_minutes,
                            timeout_seconds, lookback_minutes, priority_no,
                            next_due_at, enabled
                        ) values (?, ?, ?, ?, 'BOOKING_EVENT', 'NORMAL',
                                  5, 240, 120, 1, ?, true)
                        """,
                        targetTenantId,
                        targetHotelId,
                        stableId("it-file-fixture|" + targetHotelId),
                        scheduleId,
                        Timestamp.from(
                                Instant.parse("2026-07-19T10:10:00Z")))));
        assertThat(tenantRead(
                transactions,
                jdbc,
                targetTenantId,
                () -> jdbc.queryForObject("""
                        select count(*)
                          from ota.connector_collection_schedule
                         where tenant_id = ?
                           and hotel_id = ?
                           and schedule_id = ?
                        """,
                        Integer.class,
                        targetTenantId,
                        targetHotelId,
                        scheduleId))).isZero();
    }

    private static void assertOrdinaryCollectionControlEvidence(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            UUID hotelId,
            int expectedCollections) {
        tenantRead(transactions, jdbc, tenantId, () -> {
            assertThat(jdbc.queryForObject("""
                    select count(*)
                      from ota.connector_collection_run
                     where hotel_id = ?
                       and simulation_run_id is null
                       and status = 'SUCCESS'
                       and completeness_code = 'COMPLETE'
                    """, Integer.class, hotelId))
                    .isEqualTo(expectedCollections);
            assertThat(jdbc.queryForObject("""
                    select count(*)
                      from ota.connector_collection_run
                     where hotel_id = ?
                       and simulation_run_id is null
                       and trigger_type = 'NORMAL'
                       and scheduled_for =
                           '2026-07-19 10:05:00+00'::timestamptz
                       and cutoff_at =
                           '2026-07-19 10:05:00+00'::timestamptz
                       and status = 'SUCCESS'
                    """, Integer.class, hotelId))
                    .isEqualTo(1);
            assertThat(jdbc.queryForObject("""
                    select count(*)
                      from ota.connector_collection_attempt attempt
                      join ota.connector_collection_run run
                        on run.tenant_id = attempt.tenant_id
                       and run.hotel_id = attempt.hotel_id
                       and run.run_id = attempt.run_id
                     where attempt.hotel_id = ?
                       and run.simulation_run_id is null
                       and attempt.status = 'SUCCESS'
                    """, Integer.class, hotelId))
                    .isEqualTo(expectedCollections);
            assertThat(jdbc.queryForObject("""
                    select count(*)
                      from ota.connector_stream_checkpoint
                     where hotel_id = ?
                       and freshness_state = 'FRESH'
                       and committed_run_id is not null
                    """, Integer.class, hotelId))
                    .isEqualTo(expectedCollections - 1);
            var rawRecordCount = jdbc.queryForObject("""
                    select count(*)
                      from ota.source_raw_record raw_record
                      join ota.connector_collection_run run
                        on run.tenant_id = raw_record.tenant_id
                       and run.hotel_id = raw_record.hotel_id
                       and run.run_id = raw_record.run_id
                     where raw_record.hotel_id = ?
                       and run.simulation_run_id is null
                    """, Integer.class, hotelId);
            var standardRecordCount = jdbc.queryForObject("""
                    select count(*)
                      from ota.source_standard_record standard_record
                      join ota.connector_collection_run run
                        on run.tenant_id = standard_record.tenant_id
                       and run.hotel_id = standard_record.hotel_id
                       and run.run_id = standard_record.run_id
                     where standard_record.hotel_id = ?
                       and run.simulation_run_id is null
                    """, Integer.class, hotelId);
            assertThat(rawRecordCount).isPositive();
            assertThat(standardRecordCount).isEqualTo(rawRecordCount);
            return null;
        });
    }

    private static RunEvidence executeRun(
            JdbcSprint1ControlPlanePort api,
            TransactionTemplate apiTransactions,
            JdbcTemplate apiJdbc,
            JdbcSimulationJobRepository worker,
            DeterministicSimulationPipeline pipeline,
            UUID actorAccountId,
            UUID workerPrincipalId,
            UUID tenantId,
            UUID hotelId,
            String idempotencyKey,
            SimulationScenarioCode scenario,
            int sequence) {
        UUID runId = stableId(
                "it-run|" + tenantId + "|" + hotelId + "|" + idempotencyKey);
        Sprint1Mutations.TriggerSimulation trigger =
                new Sprint1Mutations.TriggerSimulation(
                        hotelId, runId, scenario.name());
        Sprint1TenantCommand command = command(
                tenantId, actorAccountId, idempotencyKey, trigger);
        tenantWrite(
                apiTransactions,
                apiJdbc,
                tenantId,
                () -> api.handle(command));

        Instant claimedAt = EXECUTION_AT.plusSeconds(sequence * 10L);
        ClaimedSimulationJob claimed = worker.claimNext(
                        workerPrincipalId,
                        claimedAt,
                        Duration.ofMinutes(5))
                .orElseThrow(() -> new AssertionError(
                        "API-triggered simulation job was not claimable"));
        assertThat(claimed.simulationRunId()).isEqualTo(runId);
        assertThat(claimed.fixedClockAt()).isEqualTo(EXECUTION_AT);
        assertThat(claimed.scheduledFor()).isEqualTo(CUTOFF_AT);

        SimulationRunResult result = pipeline.run(new SimulationRunCommand(
                claimed.scope(),
                claimed.hotelName(),
                claimed.scenarioCode(),
                claimed.simulationRunId(),
                claimed.configuration()));
        worker.persistSuccessfulRun(
                claimed,
                result,
                workerPrincipalId,
                claimedAt.plusSeconds(1));

        Sprint1Views.SimulationRunView view = tenantRead(
                apiTransactions,
                apiJdbc,
                tenantId,
                () -> api.findSimulationRun(hotelId, runId).orElseThrow());
        assertThat(view.status()).isEqualTo("SUCCEEDED");
        assertThat(view.briefId()).isNotNull();
        return new RunEvidence(result, view);
    }

    private static Sprint1TenantCommand command(
            UUID tenantId,
            UUID actorAccountId,
            String idempotencyKey,
            Sprint1Mutations.Mutation mutation) {
        return new Sprint1TenantCommand(
                tenantId,
                actorAccountId,
                idempotencyKey,
                0,
                "SPRINT1_POSTGRES_CLOSED_LOOP_IT",
                sha256(tenantId + "|" + mutation.canonicalForm()),
                mutation);
    }

    private static SourceConnectorRegistry connectorRegistry() {
        Clock clock = Clock.fixed(EXECUTION_AT, ZoneOffset.UTC);
        BuiltInOfficialExportParser parser =
                new BuiltInOfficialExportParser(clock);
        return new SourceConnectorRegistry(List.<SourceConnector>of(
                        new SimulationPmsConnector(clock),
                        new SimulationCtripConnector(clock),
                        new SimulationMeituanConnector(clock),
                        new FileFixtureConnector(clock, parser)));
    }

    private static <T> T tenantRead(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            Supplier<T> action) {
        return tenantWrite(transactions, jdbc, tenantId, action);
    }

    private static <T> T tenantWrite(
            TransactionTemplate transactions,
            JdbcTemplate jdbc,
            UUID tenantId,
            Supplier<T> action) {
        return transactions.execute(status -> {
            jdbc.queryForObject(
                    "select set_config('app.tenant_id', ?, true)",
                    String.class,
                    tenantId.toString());
            return action.get();
        });
    }

    private static TransactionTemplate transactionTemplate(DataSource dataSource) {
        return new TransactionTemplate(new DataSourceTransactionManager(dataSource));
    }

    private static DataSource dataSource(
            String url,
            String username,
            String password) {
        DriverManagerDataSource dataSource =
                new DriverManagerDataSource(url, username, password);
        dataSource.setConnectionProperties(new java.util.Properties() {{
            setProperty("ApplicationName", "ota-sprint1-real-pg-it");
        }});
        return dataSource;
    }

    private static void createRuntimeRoles(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            RuntimeRoles roles,
            Set<String> createdRoles) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword);
             Statement statement = connection.createStatement()) {
            createRole(
                    statement, roles.apiRole(), roles.apiPassword());
            createdRoles.add(roles.apiRole());
            createRole(
                    statement, roles.workerRole(), roles.workerPassword());
            createdRoles.add(roles.workerRole());
            createRole(
                    statement, roles.auditRole(), roles.auditPassword());
            createdRoles.add(roles.auditRole());
        }
    }

    private static void createRole(
            Statement statement,
            String role,
            String password) throws SQLException {
        statement.execute(
                "create role " + role
                        + " with login password '" + password
                        + "' nosuperuser nocreatedb nocreaterole"
                        + " noinherit noreplication nobypassrls");
    }

    private static void applyRuntimeGrantMatrix(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            Path grantScript,
            RuntimeRoles roles,
            UUID workerPrincipalId,
            String workerSlot) throws SQLException, IOException {
        String sql = Files.readAllLines(grantScript, StandardCharsets.UTF_8)
                .stream()
                .filter(line -> !line.stripLeading().startsWith("\\"))
                .reduce("", (left, right) -> left + right + "\n")
                .replace(":'api_role'", "'" + roles.apiRole() + "'")
                .replace(":'worker_role'", "'" + roles.workerRole() + "'")
                .replace(":'audit_role'", "'" + roles.auditRole() + "'")
                .replace(
                        ":'worker_service_principal_id'",
                        "'" + workerPrincipalId + "'")
                .replace(":'worker_slot'", "'" + workerSlot + "'");
        try (Connection connection = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword);
             Statement statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static void seedWorkloadIdentities(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            UUID actorAccountId,
            UUID workerPrincipalId) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword)) {
            connection.setAutoCommit(false);
            try (PreparedStatement account = connection.prepareStatement("""
                    insert into control.auth_account(
                        account_id, login_name, display_name, status
                    ) values (?, ?, 'Sprint 1 PostgreSQL IT Admin', 'ACTIVE')
                    """);
                 PreparedStatement accountRole = connection.prepareStatement("""
                    insert into control.account_role(
                        account_role_id, account_id, role_id,
                        granted_by_account_id, grant_reason_code
                    ) values (?, ?, ?, ?, 'SPRINT1_POSTGRES_CLOSED_LOOP_IT')
                    """);
                 PreparedStatement principal = connection.prepareStatement("""
                    insert into control.service_principal(
                        service_principal_id, principal_code, purpose, status
                    ) values (?, ?, 'CONNECTOR_WORKER', 'ACTIVE')
                    """)) {
                account.setObject(1, actorAccountId);
                account.setString(
                        2, "sprint1-pg-it-" + shortId(actorAccountId));
                account.executeUpdate();

                accountRole.setObject(1, UUID.randomUUID());
                accountRole.setObject(2, actorAccountId);
                accountRole.setObject(3, PLATFORM_ADMIN_ROLE_ID);
                accountRole.setObject(4, actorAccountId);
                accountRole.executeUpdate();

                principal.setObject(1, workerPrincipalId);
                principal.setString(
                        2, "OTA_SPRINT1_PG_IT_" + shortId(workerPrincipalId));
                principal.executeUpdate();
            }
            connection.commit();
        }
    }

    private static void assertOutboundDeliveryRemainsImpossible(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            UUID tenantId,
            UUID hotelId,
            int expectedRuns,
            int expectedDeliveries) throws SQLException {
        try (Connection connection = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword);
             PreparedStatement statement = connection.prepareStatement("""
                    select
                        (select count(*)
                           from ota.simulation_run
                          where tenant_id = ? and hotel_id = ?
                            and delivery_mode = 'SIMULATION_ONLY'
                            and not external_delivery_allowed) as safe_runs,
                        (select count(*)
                           from ota.notification_delivery
                          where tenant_id = ? and hotel_id = ?
                            and delivery_status = 'SIMULATED'
                            and final_outcome_code = 'DELIVERY_BLOCKED'
                            and not external_delivery_allowed) as blocked_deliveries,
                        (select bool_and(
                                    transport_mode = 'SIMULATION_ONLY'
                                    and not external_delivery_allowed)
                           from ota.hotel_message_endpoint
                          where tenant_id = ? and hotel_id = ?) as safe_endpoint
                    """)) {
            statement.setObject(1, tenantId);
            statement.setObject(2, hotelId);
            statement.setObject(3, tenantId);
            statement.setObject(4, hotelId);
            statement.setObject(5, tenantId);
            statement.setObject(6, hotelId);
            try (ResultSet result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt("safe_runs")).isEqualTo(expectedRuns);
                assertThat(result.getInt("blocked_deliveries"))
                        .isEqualTo(expectedDeliveries);
                assertThat(result.getBoolean("safe_endpoint")).isTrue();
            }
        }
    }

    private static void dropRuntimeRoles(
            String adminUrl,
            String adminUsername,
            String adminPassword,
            Set<String> createdRoles) throws SQLException {
        if (createdRoles.isEmpty()) {
            return;
        }
        try (Connection connection = DriverManager.getConnection(
                adminUrl, adminUsername, adminPassword);
             Statement statement = connection.createStatement();
             PreparedStatement bindingLookup = connection.prepareStatement("""
                     select exists (
                         select 1
                           from control.service_principal_database_role_binding
                          where database_role_name = ?::name
                     )
                     """)) {
            List<String> roles = new ArrayList<>(createdRoles);
            java.util.Collections.reverse(roles);
            for (String role : roles) {
                bindingLookup.setString(1, role);
                try (ResultSet result = bindingLookup.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    if (result.getBoolean(1)) {
                        continue;
                    }
                }
                statement.execute("drop owned by " + role);
                statement.execute("drop role " + role);
            }
        }
    }

    private static void assertMoney(BigDecimal actual, String expected) {
        assertThat(actual).isNotNull();
        assertThat(actual.compareTo(new BigDecimal(expected))).isZero();
    }

    private static UUID stableId(String value) {
        return UUID.nameUUIDFromBytes(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String shortId(UUID value) {
        return value.toString().replace("-", "").substring(0, 12)
                .toUpperCase(java.util.Locale.ROOT);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String randomHex(int bytes) {
        byte[] value = new byte[bytes];
        new SecureRandom().nextBytes(value);
        try {
            return HexFormat.of().formatHex(value);
        } finally {
            java.util.Arrays.fill(value, (byte) 0);
        }
    }

    private static String required(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " is required");
        }
        return value;
    }

    private record RuntimeRoles(
            String apiRole,
            String apiPassword,
            String workerRole,
            String workerPassword,
            String auditRole,
            String auditPassword) {
        private static RuntimeRoles random() {
            String suffix = randomHex(8);
            return new RuntimeRoles(
                    "ota_it_api_" + suffix,
                    randomHex(24),
                    "ota_it_worker_" + suffix,
                    randomHex(24),
                    "ota_it_audit_" + suffix,
                    randomHex(24));
        }
    }

    private record RunEvidence(
            SimulationRunResult result,
            Sprint1Views.SimulationRunView view) {
    }

    private record LeasedJob(UUID jobId, UUID leaseId) {
    }
}
