package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Service
public class KpiImportService {
    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final SimpleXlsxReader xlsxReader;
    private final KpiWorkbookAnalyzer workbookAnalyzer;
    private final KpiCatalogService catalogService;
    private final ObjectMapper objectMapper;

    public KpiImportService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            SimpleXlsxReader xlsxReader,
            KpiWorkbookAnalyzer workbookAnalyzer,
            KpiCatalogService catalogService,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.xlsxReader = xlsxReader;
        this.workbookAnalyzer = workbookAnalyzer;
        this.catalogService = catalogService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Map<String, Object> upload(MultipartFile file) {
        accessPolicy.requirePermission("kpi.template.import");
        TenantPrincipal principal = prepare();
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("请选择Excel考核表");
        if (file.getSize() > 10 * 1024 * 1024) throw new IllegalArgumentException("Excel文件不能超过10MB");
        String name = file.getOriginalFilename() == null ? "kpi.xlsx" : file.getOriginalFilename();
        if (!name.toLowerCase(Locale.ROOT).endsWith(".xlsx")) throw new IllegalArgumentException("当前仅支持.xlsx考核表");
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException exception) {
            throw new IllegalArgumentException("无法读取上传文件", exception);
        }
        SimpleXlsxReader.WorkbookData workbook = xlsxReader.readWorkbook(bytes);
        List<Map<String, String>> rows = xlsxReader.read(bytes);
        KpiWorkbookAnalyzer.Analysis analysis = workbookAnalyzer.analyze(workbook, positionOptions(principal));
        UUID id = UUID.randomUUID();
        boolean smart = !analysis.templates().isEmpty();
        String status = smart ? "VALIDATED" : (rows.isEmpty() ? "FAILED" : "MAPPING_REQUIRED");
        String errors = rows.isEmpty() && !smart ? "[\"工作簿没有可导入数据\"]" : "[]";
        jdbc.update("""
                insert into kpi_template_import_job
                    (id, tenant_id, original_name, media_type, size_bytes, sha256,
                     original_content, status, extracted_rows, validation_errors, created_by)
                values (:id, :tenantId, :name, :mediaType, :sizeBytes, :sha256,
                        :content, :status, cast(:rows as jsonb), cast(:errors as jsonb), :actorId)
                """, base(principal).addValue("id", id).addValue("name", name)
                .addValue("mediaType", file.getContentType() == null
                        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : file.getContentType())
                .addValue("sizeBytes", bytes.length).addValue("sha256", KpiHashing.sha256(bytes))
                .addValue("content", bytes).addValue("status", status)
                .addValue("rows", json(rows)).addValue("errors", errors)
                .addValue("actorId", principal.actorId()));
        auditWriter.record("KPI_TEMPLATE_IMPORT_UPLOADED", "KPI_TEMPLATE_IMPORT", id,
                json(Map.of("fileName", name, "rowCount", rows.size(), "status", status)));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("fileName", name);
        result.put("rowCount", rows.size());
        result.put("sheetCount", workbook.sheets().size());
        result.put("status", status);
        result.put("importMode", smart ? "SMART_WORKBOOK" : "COLUMN_MAPPING");
        result.put("headers", rows.isEmpty() ? List.of() : rows.getFirst().keySet());
        result.put("preview", rows.stream().limit(20).toList());
        result.put("templates", analysis.templates());
        result.put("ignoredSheets", analysis.ignoredSheets());
        return result;
    }

    @Transactional
    public Map<String, Object> generateDrafts(UUID jobId, KpiModels.SmartImportRequest request) {
        accessPolicy.requirePermission("kpi.template.import");
        TenantPrincipal principal = prepare();
        Map<String, Object> job = jdbc.queryForMap("""
                select id, status, original_content
                from kpi_template_import_job where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", jobId));
        if ("APPLIED".equals(job.get("status"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "该考核表已经生成模板草稿，请重新上传后再生成新版本");
        }
        List<KpiWorkbookAnalyzer.PositionOption> positions = positionOptions(principal);
        Map<UUID, KpiWorkbookAnalyzer.PositionOption> positionsById = new LinkedHashMap<>();
        for (KpiWorkbookAnalyzer.PositionOption position : positions) positionsById.put(position.id(), position);
        KpiWorkbookAnalyzer.Analysis analysis = workbookAnalyzer.analyze(
                xlsxReader.readWorkbook((byte[]) job.get("original_content")), positions);
        Map<String, KpiWorkbookAnalyzer.DetectedTemplate> detectedBySheet = new LinkedHashMap<>();
        for (KpiWorkbookAnalyzer.DetectedTemplate detected : analysis.templates()) {
            detectedBySheet.put(detected.sheetName(), detected);
        }
        Set<String> sheetNames = new HashSet<>();
        Set<String> templateCodes = new HashSet<>();
        for (KpiModels.SmartImportSelection selection : request.templates()) {
            if (!sheetNames.add(selection.sheetName())) throw new IllegalArgumentException("岗位工作表不可重复选择");
            if (!templateCodes.add(selection.templateCode().trim().toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException("模板编码不可重复");
            }
            if (!detectedBySheet.containsKey(selection.sheetName())) {
                throw new IllegalArgumentException("工作表未识别为岗位KPI：" + selection.sheetName());
            }
            if (!positionsById.containsKey(selection.positionId())) {
                throw new IllegalArgumentException("所选岗位不存在或已停用：" + selection.sheetName());
            }
        }
        List<Map<String, Object>> drafts = new ArrayList<>();
        UUID firstVersionId = null;
        for (KpiModels.SmartImportSelection selection : request.templates()) {
            KpiWorkbookAnalyzer.DetectedTemplate detected = detectedBySheet.get(selection.sheetName());
            UUID templateId = existingTemplate(principal, selection.templateCode(), selection.positionId());
            if (templateId == null) {
                Map<String, Object> template = catalogService.createTemplate(new KpiModels.CreateTemplate(
                        selection.templateCode(), selection.templateName(),
                        "由门店岗位KPI工作簿智能识别导入；发布前需复核评分阶梯、数据源和红线规则",
                        "POSITION", null, selection.positionId()));
                templateId = (UUID) template.get("id");
            }
            List<KpiModels.SectionInput> sections = importedSections(detected, jobId);
            BigDecimal total = sections.stream().map(KpiModels.SectionInput::maxScore)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            JsonNode configuration = objectMapper.createObjectNode()
                    .put("importMode", "SMART_WORKBOOK")
                    .put("importJobId", jobId.toString())
                    .put("sourceSheet", detected.sheetName())
                    .put("sourceBonusBase", detected.bonusBase() == null ? "" : detected.bonusBase().toPlainString())
                    .put("ruleReviewRequired", true)
                    .set("importWarnings", objectMapper.valueToTree(detected.warnings()));
            Map<String, Object> version = catalogService.createTemplateVersion(templateId,
                    new KpiModels.CreateTemplateVersion("工作簿智能导入草稿", "可直接修改指标、权重和评分标准；发布前必须复核",
                            null, null, total, true, null, null, configuration, sections));
            UUID versionId = (UUID) version.get("id");
            if (firstVersionId == null) firstVersionId = versionId;
            Map<String, Object> draft = new LinkedHashMap<>();
            draft.put("sheetName", detected.sheetName());
            draft.put("templateId", templateId);
            draft.put("templateVersionId", versionId);
            draft.put("templateCode", selection.templateCode().trim().toUpperCase(Locale.ROOT));
            draft.put("templateName", selection.templateName().trim());
            draft.put("positionId", selection.positionId());
            draft.put("positionName", positionsById.get(selection.positionId()).name());
            draft.put("baseFullScore", total);
            draft.put("indicatorCount", detected.indicators().size());
            draft.put("warnings", detected.warnings());
            drafts.add(draft);
        }
        jdbc.update("""
                update kpi_template_import_job set status = 'APPLIED',
                    field_mapping = cast(:mapping as jsonb), validation_errors = '[]'::jsonb,
                    result_template_version_id = :versionId
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", jobId)
                .addValue("mapping", json(Map.of("mode", "SMART_WORKBOOK", "templates", request.templates())))
                .addValue("versionId", firstVersionId));
        auditWriter.record("KPI_TEMPLATE_SMART_IMPORT_APPLIED", "KPI_TEMPLATE_IMPORT", jobId,
                json(Map.of("draftCount", drafts.size(), "drafts", drafts)));
        return Map.of("id", jobId, "status", "APPLIED", "draftCount", drafts.size(), "drafts", drafts);
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list() {
        accessPolicy.requirePermission("kpi.template.import");
        TenantPrincipal principal = prepare();
        return jdbc.queryForList("""
                select id, original_name, media_type, size_bytes, sha256, status,
                       jsonb_array_length(extracted_rows) as row_count, field_mapping,
                       validation_errors, result_template_version_id, created_at, updated_at
                from kpi_template_import_job where tenant_id = :tenantId
                order by created_at desc limit 100
                """, base(principal));
    }

    @Transactional
    public Map<String, Object> apply(UUID jobId, KpiModels.ImportMapping request) {
        accessPolicy.requirePermission("kpi.template.import");
        TenantPrincipal principal = prepare();
        Map<String, Object> job = jdbc.queryForMap("""
                select id, status, extracted_rows::text as rows_text
                from kpi_template_import_job where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", jobId));
        if ("APPLIED".equals(job.get("status"))) throw new ResponseStatusException(HttpStatus.CONFLICT, "该考核表已经生成模板");
        List<Map<String, String>> rows;
        try {
            rows = objectMapper.readValue(String.valueOf(job.get("rows_text")), new TypeReference<>() { });
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("导入任务数据损坏", exception);
        }
        Map<String, String> mapping = request.fieldMapping();
        requireMapping(mapping, "section", "indicator", "maxScore");
        Map<String, List<KpiModels.IndicatorInput>> grouped = new LinkedHashMap<>();
        List<String> errors = new ArrayList<>();
        int rowNo = 1;
        for (Map<String, String> row : rows) {
            rowNo++;
            String section = cell(row, mapping, "section");
            String indicator = cell(row, mapping, "indicator");
            String scoreText = cell(row, mapping, "maxScore");
            if (section.isBlank() || indicator.isBlank() || scoreText.isBlank()) {
                errors.add("第" + rowNo + "行缺少板块、指标或分值");
                continue;
            }
            BigDecimal maxScore;
            try {
                maxScore = new BigDecimal(scoreText.replace("%", "").trim());
            } catch (NumberFormatException exception) {
                errors.add("第" + rowNo + "行分值不是数字");
                continue;
            }
            BigDecimal target = decimal(cell(row, mapping, "target"));
            String type = defaultText(cell(row, mapping, "indicatorType"), "MANUAL");
            String weekly = defaultText(cell(row, mapping, "weeklySplitType"), "SAME_TARGET");
            UUID metricVersionId = uuid(cell(row, mapping, "metricVersionId"));
            JsonNode formula = JsonNodeFactory.instance.objectNode()
                    .put("imported", true)
                    .put("metricNature", "SAME_TARGET".equalsIgnoreCase(weekly) ? "RATIO_OR_THRESHOLD" : "TOTAL");
            grouped.computeIfAbsent(section, ignored -> new ArrayList<>()).add(new KpiModels.IndicatorInput(
                    null, code(indicator), indicator, type, weekly, metricVersionId, maxScore,
                    decimal(cell(row, mapping, "minScore")), target, false, 2,
                    true, "MANUAL".equalsIgnoreCase(type) ? "MANUAL_EVALUATOR" : "SYSTEM",
                    "PENDING_VERIFICATION", grouped.size(), formula, JsonNodeFactory.instance.objectNode()
            ));
        }
        if (!errors.isEmpty()) {
            jdbc.update("""
                    update kpi_template_import_job set status = 'FAILED',
                        field_mapping = cast(:mapping as jsonb), validation_errors = cast(:errors as jsonb)
                    where tenant_id = :tenantId and id = :id
                    """, base(principal).addValue("id", jobId).addValue("mapping", json(mapping))
                    .addValue("errors", json(errors)));
            return Map.of("id", jobId, "status", "FAILED", "errors", errors);
        }
        List<KpiModels.SectionInput> sections = new ArrayList<>();
        int order = 0;
        BigDecimal total = BigDecimal.ZERO;
        for (Map.Entry<String, List<KpiModels.IndicatorInput>> entry : grouped.entrySet()) {
            BigDecimal sectionScore = entry.getValue().stream().map(KpiModels.IndicatorInput::maxScore)
                    .reduce(BigDecimal.ZERO, BigDecimal::add);
            total = total.add(sectionScore);
            sections.add(new KpiModels.SectionInput(null, code(entry.getKey()), entry.getKey(),
                    sectionScore, null, order++, JsonNodeFactory.instance.objectNode(), entry.getValue()));
        }
        Map<String, Object> template = catalogService.createTemplate(new KpiModels.CreateTemplate(
                request.templateCode(), request.templateName(), "由Excel考核表导入，发布前必须完成人工核对",
                request.ownerOrgUnitId() == null ? "POSITION" : "STORE_SUPPLEMENT",
                request.ownerOrgUnitId(), request.positionId()
        ));
        UUID templateId = (UUID) template.get("id");
        Map<String, Object> version = catalogService.createTemplateVersion(templateId,
                new KpiModels.CreateTemplateVersion("Excel导入草稿", "必须完成字段、公式、数据源和证据复核",
                        null, null, total, true, null, null,
                        JsonNodeFactory.instance.objectNode().put("importJobId", jobId.toString()), sections));
        UUID versionId = (UUID) version.get("id");
        jdbc.update("""
                update kpi_template_import_job set status = 'APPLIED',
                    field_mapping = cast(:mapping as jsonb), validation_errors = '[]'::jsonb,
                    result_template_version_id = :versionId
                where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", jobId).addValue("mapping", json(mapping))
                .addValue("versionId", versionId));
        auditWriter.record("KPI_TEMPLATE_IMPORT_APPLIED", "KPI_TEMPLATE_IMPORT", jobId,
                json(Map.of("templateId", templateId, "versionId", versionId)));
        return Map.of("id", jobId, "status", "APPLIED", "templateId", templateId,
                "templateVersionId", versionId);
    }

    private List<KpiModels.SectionInput> importedSections(
            KpiWorkbookAnalyzer.DetectedTemplate detected,
            UUID jobId
    ) {
        Map<String, List<KpiWorkbookAnalyzer.DetectedIndicator>> grouped = new LinkedHashMap<>();
        for (KpiWorkbookAnalyzer.DetectedIndicator indicator : detected.indicators()) {
            grouped.computeIfAbsent(indicator.section(), ignored -> new ArrayList<>()).add(indicator);
        }
        List<KpiModels.SectionInput> sections = new ArrayList<>();
        int sectionOrder = 0;
        for (Map.Entry<String, List<KpiWorkbookAnalyzer.DetectedIndicator>> entry : grouped.entrySet()) {
            List<KpiModels.IndicatorInput> indicators = new ArrayList<>();
            BigDecimal sectionScore = BigDecimal.ZERO;
            for (KpiWorkbookAnalyzer.DetectedIndicator imported : entry.getValue()) {
                sectionScore = sectionScore.add(imported.maxScore());
                JsonNode formula = objectMapper.createObjectNode()
                        .put("imported", true)
                        .put("importJobId", jobId.toString())
                        .put("sourceSheet", detected.sheetName())
                        .put("sourceCriteria", imported.criteria())
                        .put("sourceWeight", imported.sourceWeight())
                        .put("metricNature", "EQUAL_FOUR_WEEKS".equals(imported.weeklySplitType()) ? "TOTAL" : "RATIO_OR_THRESHOLD")
                        .put("redline", imported.redline())
                        .put("bonus", imported.bonus())
                        .put("negativeAllowed", imported.redline() || imported.minScore() != null && imported.minScore().signum() < 0)
                        .put("requiresRuleReview", true)
                        .set("scoreTiers", objectMapper.valueToTree(imported.tiers()));
                indicators.add(new KpiModels.IndicatorInput(
                        null,
                        code(imported.name()) + "_" + (imported.sortOrder() + 1),
                        imported.name(),
                        "MANUAL",
                        imported.weeklySplitType(),
                        null,
                        imported.maxScore(),
                        imported.minScore(),
                        imported.targetValue(),
                        imported.bonus() || imported.allowAboveMax(),
                        2,
                        true,
                        "MANUAL_EVALUATOR",
                        "PENDING_VERIFICATION",
                        imported.sortOrder(),
                        formula,
                        JsonNodeFactory.instance.objectNode()
                ));
            }
            JsonNode sectionConfiguration = objectMapper.createObjectNode()
                    .put("sourceSheet", detected.sheetName())
                    .put("smartImported", true);
            sections.add(new KpiModels.SectionInput(null,
                    code(entry.getKey()) + "_" + (sectionOrder + 1), entry.getKey(), sectionScore,
                    null, sectionOrder, sectionConfiguration, indicators));
            sectionOrder++;
        }
        return List.copyOf(sections);
    }

    private UUID existingTemplate(TenantPrincipal principal, String templateCode, UUID positionId) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                select id, position_id from kpi_template_definition
                where tenant_id = :tenantId and code = :code
                """, base(principal).addValue("code", templateCode.trim().toUpperCase(Locale.ROOT)));
        if (rows.isEmpty()) return null;
        UUID existingPositionId = (UUID) rows.getFirst().get("position_id");
        if (!positionId.equals(existingPositionId)) {
            throw new IllegalArgumentException("模板编码已被其他岗位使用：" + templateCode);
        }
        return (UUID) rows.getFirst().get("id");
    }

    private List<KpiWorkbookAnalyzer.PositionOption> positionOptions(TenantPrincipal principal) {
        return jdbc.query("""
                select id, code, name from position_definition
                where tenant_id = :tenantId and status = 'ACTIVE'
                order by job_family, level_code, name
                """, base(principal), (rs, rowNum) -> new KpiWorkbookAnalyzer.PositionOption(
                rs.getObject("id", UUID.class), rs.getString("code"), rs.getString("name")));
    }

    @Transactional(readOnly = true)
    public ImportFile original(UUID jobId) {
        accessPolicy.requirePermission("kpi.template.import");
        TenantPrincipal principal = prepare();
        List<ImportFile> files = jdbc.query("""
                select original_name, media_type, original_content
                from kpi_template_import_job where tenant_id = :tenantId and id = :id
                """, base(principal).addValue("id", jobId), (rs, rowNum) -> new ImportFile(
                rs.getString("original_name"), rs.getString("media_type"), rs.getBytes("original_content")));
        if (files.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "导入原件不存在");
        return files.getFirst();
    }

    private String cell(Map<String, String> row, Map<String, String> mapping, String field) {
        String column = mapping.get(field);
        return column == null ? "" : row.getOrDefault(column, "").trim();
    }

    private void requireMapping(Map<String, String> mapping, String... fields) {
        for (String field : fields) {
            if (mapping.get(field) == null || mapping.get(field).isBlank()) {
                throw new IllegalArgumentException("字段映射缺少：" + field);
            }
        }
    }

    private BigDecimal decimal(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return new BigDecimal(value.replace("%", "").trim());
        } catch (NumberFormatException exception) {
            return null;
        }
    }

    private UUID uuid(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return UUID.fromString(value.trim());
        } catch (IllegalArgumentException exception) {
            return null;
        }
    }

    private String code(String value) {
        String normalized = value.trim().toUpperCase(Locale.ROOT)
                .replaceAll("[^A-Z0-9\\p{IsHan}]+", "_");
        return normalized.length() > 80 ? normalized.substring(0, 80) : normalized;
    }

    private String defaultText(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim().toUpperCase(Locale.ROOT);
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String json(Object value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("无法序列化导入数据", exception);
        }
    }

    public record ImportFile(String name, String mediaType, byte[] content) {
    }
}
