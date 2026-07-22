package cn.sifangguan.hotelaios.dailyoperations;

import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.CreateExportRequest;
import cn.sifangguan.hotelaios.dailyoperations.OperationIntelligenceModels.OperationExportView;
import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.idempotency.CommandIdempotencyService;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import cn.sifangguan.hotelaios.shared.time.BusinessDayService;
import cn.sifangguan.hotelaios.workdata.AttachmentService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/** Audited asynchronous operation-export job creation. */
@Service
public class OperationExportService {
    private static final Map<String, String> FORMATS = Map.of(
            "EXCEL_DETAIL", "XLSX",
            "CSV_DETAIL", "CSV",
            "PDF_SUMMARY", "PDF",
            "EVIDENCE_LIST", "EVIDENCE_LIST",
            "XLSX", "XLSX",
            "CSV", "CSV",
            "PDF", "PDF");

    private final NamedParameterJdbcTemplate jdbc;
    private final AccessPolicy accessPolicy;
    private final OperationScopeService scopes;
    private final BusinessDayService businessDayService;
    private final CommandIdempotencyService idempotencyService;
    private final AuditWriter auditWriter;
    private final ObjectMapper objectMapper;
    private final AttachmentService attachmentService;
    private final OperationExportExpiryService expiryService;

    public OperationExportService(
            NamedParameterJdbcTemplate jdbc,
            AccessPolicy accessPolicy,
            OperationScopeService scopes,
            BusinessDayService businessDayService,
            CommandIdempotencyService idempotencyService,
            AuditWriter auditWriter,
            ObjectMapper objectMapper,
            AttachmentService attachmentService,
            OperationExportExpiryService expiryService
    ) {
        this.jdbc = jdbc;
        this.accessPolicy = accessPolicy;
        this.scopes = scopes;
        this.businessDayService = businessDayService;
        this.idempotencyService = idempotencyService;
        this.auditWriter = auditWriter;
        this.objectMapper = objectMapper;
        this.attachmentService = attachmentService;
        this.expiryService = expiryService;
    }

    @Transactional(readOnly = true)
    public List<OperationExportView> list() {
        accessPolicy.requirePermission("daily-operation.read");
        accessPolicy.requireAnyPermission("operation-export.create", "operation-export.download");
        TenantPrincipal principal = scopes.prepare();
        return jdbc.query("""
                select job.id,
                       coalesce(job.filter_snapshot ->> 'exportType', job.export_format) as export_type,
                       job.business_date, coalesce(scope_org.name, hotel.name, '全部授权组织') as org_name,
                       job.status, job.sensitivity_level, job.created_at, job.expires_at, job.object_key
                from operation_export_job job
                left join org_unit scope_org
                  on scope_org.tenant_id = job.tenant_id and scope_org.id = job.org_unit_id
                left join org_unit hotel
                  on hotel.tenant_id = job.tenant_id and hotel.id = job.hotel_org_unit_id
                where job.tenant_id = :tenantId and job.requested_by_account_id = :actorId
                  and (:tenantScope or job.org_unit_id in (:orgScopes))
                order by job.created_at desc
                limit 200
                """, scopes.visibility(principal).addValue("actorId", principal.actorId()),
                (rs, rowNum) -> new OperationExportView(
                        rs.getObject("id", UUID.class), rs.getString("export_type"),
                        rs.getObject("business_date", LocalDate.class), rs.getString("org_name"),
                        rs.getString("status"),
                        "SENSITIVE".equals(rs.getString("sensitivity_level"))
                                || "RESTRICTED".equals(rs.getString("sensitivity_level")),
                        rs.getObject("created_at", OffsetDateTime.class),
                        rs.getObject("expires_at", OffsetDateTime.class),
                        downloadUrl(principal, rs.getObject("id", UUID.class), rs.getString("object_key"),
                                rs.getString("status"), rs.getObject("expires_at", OffsetDateTime.class))));
    }

    @Transactional
    public OperationExportView create(CreateExportRequest request, String idempotencyKey) {
        accessPolicy.requirePermission("daily-operation.read");
        accessPolicy.requirePermission("operation-export.create");
        if (request.includeSensitive()) {
            accessPolicy.requirePermission("operation-export.sensitive");
        }
        TenantPrincipal principal = scopes.prepare();
        UUID actorAssignmentId = actorAssignment(principal, request.actorAssignmentId());
        OperationScopeService.OrgSelection selected = scopes.resolveOrg(principal, request.orgUnitId());
        UUID hotelId = null;
        boolean crossHotel = !("HOTEL".equals(selected.unitType()) || "DEPARTMENT".equals(selected.unitType()));
        if (!crossHotel) {
            hotelId = businessDayService.resolve(selected.id(), request.businessDate()).hotelOrgUnitId();
        } else {
            accessPolicy.requirePermission("daily-operation.cross-hotel-read");
        }
        String exportType = requiredUpper(request.exportType());
        String format = FORMATS.get(exportType);
        if (format == null) {
            throw new IllegalArgumentException("不支持的导出类型: " + request.exportType());
        }

        CreateExportCommand command = new CreateExportCommand(
                exportType, request.businessDate(), selected.id(), request.includeSensitive(), actorAssignmentId);
        CommandIdempotencyService.Reservation reservation = idempotencyService.reserve(
                "OPERATION_EXPORT_CREATE", idempotencyKey, command, principal.correlationId());
        if (reservation.replayed()) {
            return requireJob(principal, reservation.resourceId());
        }

        UUID id = UUID.randomUUID();
        ObjectNode filters = objectMapper.createObjectNode();
        filters.put("exportType", exportType);
        filters.put("includeSensitive", request.includeSensitive());
        filters.put("orgUnitId", selected.id().toString());
        filters.put("businessDate", request.businessDate().toString());
        filters.put("crossHotel", crossHotel);
        ObjectNode authorization = objectMapper.createObjectNode();
        authorization.put("tenantScope", principal.hasTenantScope());
        authorization.put("requestedByAccountId", principal.actorId().toString());
        if (actorAssignmentId != null) {
            authorization.put("requestedByAssignmentId", actorAssignmentId.toString());
        }
        ArrayNode scopeIds = authorization.putArray("orgScopes");
        principal.orgScopes().stream().map(UUID::toString).sorted().forEach(scopeIds::add);
        ArrayNode permissionCodes = authorization.putArray("permissionCodes");
        permissionCodes.add("daily-operation.read");
        permissionCodes.add("operation-export.create");
        if (request.includeSensitive()) permissionCodes.add("operation-export.sensitive");
        if (crossHotel) permissionCodes.add("daily-operation.cross-hotel-read");

        jdbc.update("""
                insert into operation_export_job
                    (id, tenant_id, export_format, status, hotel_org_unit_id, org_unit_id,
                     business_date, filter_snapshot, authorization_snapshot, sensitivity_level,
                     requested_by_account_id, requested_by_assignment_id, trace_id)
                values
                    (:id, :tenantId, :format, 'PENDING', :hotelId, :orgUnitId,
                     :businessDate, cast(:filters as jsonb), cast(:authorization as jsonb), :sensitivity,
                     :actorId, :actorAssignmentId, :traceId)
                """, scopes.base(principal)
                .addValue("id", id)
                .addValue("format", format)
                .addValue("hotelId", hotelId)
                .addValue("orgUnitId", selected.id())
                .addValue("businessDate", request.businessDate())
                .addValue("filters", filters.toString())
                .addValue("authorization", authorization.toString())
                .addValue("sensitivity", request.includeSensitive() ? "SENSITIVE" : "INTERNAL")
                .addValue("actorId", principal.actorId())
                .addValue("actorAssignmentId", actorAssignmentId)
                .addValue("traceId", principal.correlationId()));

        OperationExportView result = requireJob(principal, id);
        idempotencyService.succeed(reservation, "OPERATION_EXPORT_JOB", id, 201, result);
        auditWriter.record("OPERATION_EXPORT_REQUESTED", "OPERATION_EXPORT_JOB", id,
                json(Map.of("exportType", exportType,
                        "includeSensitive", request.includeSensitive(),
                        "businessDate", request.businessDate().toString())));
        auditWriter.emit("OPERATION_EXPORT_JOB", id, "OPERATION_EXPORT_REQUESTED",
                json(Map.of("status", "PENDING", "exportType", exportType,
                        "businessDate", request.businessDate().toString())));
        return result;
    }

    @Transactional
    public AttachmentService.Download download(UUID jobId) {
        accessPolicy.requirePermission("daily-operation.read");
        accessPolicy.requirePermission("operation-export.download");
        TenantPrincipal principal = scopes.prepare();
        List<DownloadJob> rows = jdbc.query("""
                select job.id, job.export_format, job.status, job.hotel_org_unit_id, job.org_unit_id,
                       scope_org.unit_type as org_unit_type, job.sensitivity_level,
                       object_key, file_name, size_bytes, expires_at, sha256
                from operation_export_job job
                join org_unit scope_org
                  on scope_org.tenant_id = job.tenant_id and scope_org.id = job.org_unit_id
                where job.tenant_id = :tenantId and job.id = :id
                  and job.requested_by_account_id = :actorId
                """, scopes.base(principal).addValue("id", jobId).addValue("actorId", principal.actorId()),
                (rs, rowNum) -> new DownloadJob(
                        rs.getObject("id", UUID.class), rs.getString("export_format"),
                        rs.getString("status"), rs.getObject("hotel_org_unit_id", UUID.class),
                        rs.getObject("org_unit_id", UUID.class), rs.getString("org_unit_type"),
                        rs.getString("sensitivity_level"), rs.getString("object_key"),
                        rs.getString("file_name"), (Long) rs.getObject("size_bytes"),
                        rs.getObject("expires_at", OffsetDateTime.class), rs.getString("sha256")));
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "导出作业不存在或不属于当前账号");
        }
        DownloadJob job = rows.getFirst();
        accessPolicy.requireOrgScope(job.orgUnitId());
        if (job.hotelOrgUnitId() == null || Set.of("GROUP", "REGION").contains(job.orgUnitType())) {
            accessPolicy.requirePermission("daily-operation.cross-hotel-read");
        }
        if (Set.of("SENSITIVE", "RESTRICTED").contains(job.sensitivityLevel())) {
            accessPolicy.requirePermission("operation-export.sensitive");
        }
        if ("EXPIRED".equals(job.status())) {
            expiryService.cleanupForCurrentTenant(jobId);
            throw new ResponseStatusException(HttpStatus.GONE, "导出文件已过期");
        }
        if (!"SUCCEEDED".equals(job.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "导出作业尚未生成可下载文件");
        }
        if (job.expiresAt() == null || !job.expiresAt().isAfter(OffsetDateTime.now())) {
            expiryService.cleanupForCurrentTenant(jobId);
            throw new ResponseStatusException(HttpStatus.GONE, "导出文件已过期");
        }
        String expectedPrefix = principal.tenantId() + "/operation-exports/" + job.id() + "/";
        String objectSuffix = job.objectKey() == null ? "" : job.objectKey().substring(
                Math.min(expectedPrefix.length(), job.objectKey().length()));
        if (job.objectKey() == null || !job.objectKey().startsWith(expectedPrefix)
                || !objectSuffix.matches("attempt-[1-9][0-9]*/[\\p{L}\\p{N}._-]{1,160}")
                || job.fileName() == null || !job.objectKey().endsWith("/" + job.fileName())
                || job.sizeBytes() == null || job.sha256() == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "导出文件元数据不完整");
        }
        AttachmentService.Download download = attachmentService.openGeneratedObject(
                job.objectKey(), job.fileName(), mediaType(job.exportFormat()), job.sizeBytes(), job.sha256());
        auditWriter.record("OPERATION_EXPORT_DOWNLOADED", "OPERATION_EXPORT_JOB", job.id(),
                json(Map.of("sha256", job.sha256(), "sizeBytes", job.sizeBytes())));
        return download;
    }

    private OperationExportView requireJob(TenantPrincipal principal, UUID id) {
        if (id == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "幂等响应缺少导出作业资源标识");
        }
        List<OperationExportView> rows = jdbc.query("""
                select job.id,
                       coalesce(job.filter_snapshot ->> 'exportType', job.export_format) as export_type,
                       job.business_date, coalesce(scope_org.name, hotel.name, '全部授权组织') as org_name,
                       job.status, job.sensitivity_level, job.created_at, job.expires_at, job.object_key
                from operation_export_job job
                left join org_unit scope_org
                  on scope_org.tenant_id = job.tenant_id and scope_org.id = job.org_unit_id
                left join org_unit hotel
                  on hotel.tenant_id = job.tenant_id and hotel.id = job.hotel_org_unit_id
                where job.tenant_id = :tenantId and job.id = :id
                  and job.requested_by_account_id = :actorId
                """, scopes.base(principal)
                .addValue("id", id).addValue("actorId", principal.actorId()),
                (rs, rowNum) -> new OperationExportView(
                        rs.getObject("id", UUID.class), rs.getString("export_type"),
                        rs.getObject("business_date", LocalDate.class), rs.getString("org_name"),
                        rs.getString("status"),
                        "SENSITIVE".equals(rs.getString("sensitivity_level"))
                                || "RESTRICTED".equals(rs.getString("sensitivity_level")),
                        rs.getObject("created_at", OffsetDateTime.class),
                        rs.getObject("expires_at", OffsetDateTime.class),
                        downloadUrl(principal, rs.getObject("id", UUID.class), rs.getString("object_key"),
                                rs.getString("status"), rs.getObject("expires_at", OffsetDateTime.class))));
        if (rows.size() != 1) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "导出作业不存在或不属于当前账号");
        }
        return rows.getFirst();
    }

    private UUID actorAssignment(TenantPrincipal principal, UUID requested) {
        if (requested != null) {
            accessPolicy.requireActiveAssignment(requested);
            return requested;
        }
        if (principal.assignmentIds().size() == 1) {
            return principal.assignmentIds().stream().findFirst().orElse(null);
        }
        return null;
    }

    private static String requiredUpper(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("exportType不能为空");
        }
        return value.trim().toUpperCase(Locale.ROOT);
    }

    private static String downloadUrl(
            TenantPrincipal principal,
            UUID id,
            String objectKey,
            String status,
            OffsetDateTime expiresAt
    ) {
        if (objectKey == null || objectKey.isBlank()) return null;
        if (!"SUCCEEDED".equals(status) || expiresAt == null || !expiresAt.isAfter(OffsetDateTime.now())) return null;
        if (!principal.hasPermission("operation-export.download") && !principal.hasPermission("*")) return null;
        return "/api/v1/daily-operations/exports/" + id + "/download";
    }

    private static String mediaType(String exportFormat) {
        return switch (exportFormat) {
            case "CSV", "EVIDENCE_LIST" -> "text/csv";
            case "XLSX" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "PDF" -> "application/pdf";
            default -> throw new IllegalArgumentException("不支持的导出文件类型");
        };
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法生成导出审计JSON", exception);
        }
    }

    private record CreateExportCommand(
            String exportType,
            LocalDate businessDate,
            UUID orgUnitId,
            boolean includeSensitive,
            UUID actorAssignmentId
    ) {
    }

    private record DownloadJob(
            UUID id,
            String exportFormat,
            String status,
            UUID hotelOrgUnitId,
            UUID orgUnitId,
            String orgUnitType,
            String sensitivityLevel,
            String objectKey,
            String fileName,
            Long sizeBytes,
            OffsetDateTime expiresAt,
            String sha256
    ) {
    }
}
