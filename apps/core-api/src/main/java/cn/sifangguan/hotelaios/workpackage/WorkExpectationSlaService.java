package cn.sifangguan.hotelaios.workpackage;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantContext;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.events.TenantSystemAccountResolver;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;

@Service
public class WorkExpectationSlaService {
    static final int MAX_BATCH_SIZE = 500;
    private static final String PROCESS_PERMISSION = "work-package.manage";

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final TenantSystemAccountResolver systemAccountResolver;
    private final ObjectMapper objectMapper;

    public WorkExpectationSlaService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            TenantSystemAccountResolver systemAccountResolver,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.systemAccountResolver = systemAccountResolver;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public WorkPackageModels.SlaProcessResult processCurrentTenant(int batchLimit) {
        int validatedLimit = validateBatchLimit(batchLimit);
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        accessPolicy.requirePermission(PROCESS_PERMISSION);
        return processOverdue(principal, validatedLimit);
    }

    @Transactional
    public WorkPackageModels.SlaProcessResult processTenantAsSystem(
            UUID tenantId,
            int batchLimit,
            UUID correlationId
    ) {
        int validatedLimit = validateBatchLimit(batchLimit);
        UUID actorId = systemAccountResolver.resolveOrCreate(tenantId);
        TenantPrincipal previous = TenantContext.current().orElse(null);
        TenantPrincipal systemPrincipal = new TenantPrincipal(
                tenantId,
                actorId,
                "SYSTEM_AUTOMATION",
                Set.of("SYSTEM_AUTOMATION"),
                Set.of(PROCESS_PERMISSION),
                Set.of(),
                Set.of(),
                true,
                correlationId
        );
        TenantContext.set(systemPrincipal);
        try {
            databaseContext.apply(tenantId);
            return processOverdue(systemPrincipal, validatedLimit);
        } finally {
            if (previous == null) {
                TenantContext.clear();
            } else {
                TenantContext.set(previous);
            }
        }
    }

    private WorkPackageModels.SlaProcessResult processOverdue(TenantPrincipal principal, int batchLimit) {
        List<MissedExpectation> missed = jdbc.query("""
                with candidates as (
                    select x.id
                    from work_expectation x
                    where x.tenant_id = :tenantId
                      and x.status in ('PLANNED', 'AVAILABLE', 'IN_PROGRESS')
                      and x.due_at < now()
                    order by x.due_at, x.id
                    for update skip locked
                    limit :batchLimit
                )
                update work_expectation x
                set status = 'MISSED',
                    row_version = x.row_version + 1,
                    updated_at = now()
                from candidates c
                where x.tenant_id = :tenantId and x.id = c.id
                returning x.id, x.work_package_item_id, x.position_assignment_id,
                          x.target_org_unit_id, x.business_date, x.due_at
                """, new MapSqlParameterSource()
                .addValue("tenantId", principal.tenantId())
                .addValue("batchLimit", batchLimit),
                (rs, rowNum) -> new MissedExpectation(
                        rs.getObject("id", UUID.class),
                        rs.getObject("work_package_item_id", UUID.class),
                        rs.getObject("position_assignment_id", UUID.class),
                        rs.getObject("target_org_unit_id", UUID.class),
                        rs.getObject("business_date", LocalDate.class),
                        rs.getObject("due_at", OffsetDateTime.class)
                ));
        missed.sort(Comparator.comparing(MissedExpectation::dueAt).thenComparing(MissedExpectation::id));

        for (MissedExpectation expectation : missed) {
            String payload = payload(expectation);
            auditWriter.record("WORK_EXPECTATION_MISSED", "WORK_EXPECTATION", expectation.id(), payload);
            auditWriter.emit("WORK_EXPECTATION", expectation.id(), "WorkExpectationMissed", payload);
        }

        return new WorkPackageModels.SlaProcessResult(
                missed.size(),
                batchLimit,
                missed.stream().map(MissedExpectation::id).toList(),
                OffsetDateTime.now(ZoneOffset.UTC)
        );
    }

    private String payload(MissedExpectation expectation) {
        ObjectNode payload = objectMapper.createObjectNode();
        payload.put("workExpectationId", expectation.id().toString());
        payload.put("workPackageItemId", expectation.itemId().toString());
        payload.put("positionAssignmentId", expectation.assignmentId().toString());
        payload.put("orgUnitId", expectation.orgUnitId().toString());
        payload.put("businessDate", expectation.businessDate().toString());
        payload.put("dueAt", expectation.dueAt().toString());
        payload.put("status", "MISSED");
        return payload.toString();
    }

    private int validateBatchLimit(int batchLimit) {
        if (batchLimit < 1 || batchLimit > MAX_BATCH_SIZE) {
            throw new IllegalArgumentException("limit must be between 1 and " + MAX_BATCH_SIZE);
        }
        return batchLimit;
    }

    private record MissedExpectation(
            UUID id,
            UUID itemId,
            UUID assignmentId,
            UUID orgUnitId,
            LocalDate businessDate,
            OffsetDateTime dueAt
    ) {
    }
}
