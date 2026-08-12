package cn.sifangguan.hotelaios.performance;

import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Path;
import java.time.Duration;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

@Service
public class KpiSourcePreviewService {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final ObjectMapper objectMapper;
    private final OtaKpiSnapshotReader snapshotReader;
    private final PmsMonthlyKpiReader monthlyReader;
    private final KpiImportedTierEvaluator tierEvaluator = new KpiImportedTierEvaluator();
    private final String snapshotPath;
    private final String hotelDirectoryPath;
    private final String allowedTenantCode;
    private final String monthlySummaryPath;

    public KpiSourcePreviewService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            ObjectMapper objectMapper,
            OtaKpiSnapshotReader snapshotReader,
            PmsMonthlyKpiReader monthlyReader,
            @Value("${app.kpi.ota-source.snapshot-path:}") String snapshotPath,
            @Value("${app.kpi.ota-source.hotel-directory-path:}") String hotelDirectoryPath,
            @Value("${app.kpi.ota-source.allowed-tenant-code:}") String allowedTenantCode,
            @Value("${app.kpi.ota-source.monthly-summary-path:}") String monthlySummaryPath
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.objectMapper = objectMapper;
        this.snapshotReader = snapshotReader;
        this.monthlyReader = monthlyReader;
        this.snapshotPath = snapshotPath;
        this.hotelDirectoryPath = hotelDirectoryPath;
        this.allowedTenantCode = allowedTenantCode;
        this.monthlySummaryPath = monthlySummaryPath;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> catalog(UUID templateVersionId) {
        TenantPrincipal principal = prepare();
        TemplateHeader header = templateHeader(principal, templateVersionId);
        List<IndicatorRow> indicators = indicators(principal, templateVersionId);
        List<OtaKpiSnapshotReader.SourceHotel> hotels = sourceHotels();
        List<Map<String, Object>> hotelItems = hotels.stream().map(this::hotelItem).toList();
        int suggested = (int) indicators.stream().filter(item -> resolve(item.name()).kind() != BindingKind.MANUAL).count();
        int currentlyAvailable = hotels.stream().mapToInt(hotel -> hotel.snapshots().isEmpty() ? 0
                : (int) indicators.stream().filter(item -> resolve(item.name()).kind() == BindingKind.OCCUPANCY).count()).max().orElse(0);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("templateVersionId", templateVersionId);
        result.put("templateTitle", header.title());
        result.put("templateLifecycleStatus", header.lifecycleStatus());
        result.put("sourceMode", "READ_ONLY_EXISTING_SNAPSHOT");
        result.put("sourceConfigured", !snapshotPath.isBlank() && !hotelDirectoryPath.isBlank() && !allowedTenantCode.isBlank());
        result.put("factWriteEnabled", false);
        result.put("totalIndicators", indicators.size());
        result.put("suggestedSourceBindings", suggested);
        result.put("currentlyScoreableIndicators", currentlyAvailable);
        result.put("hotels", hotelItems);
        result.put("notice", "试算不写入正式考核；缺失数据保持待接数据或待核验，不按0分处理");
        return result;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> calculate(KpiModels.CalculateSourcePreview request) {
        if (request.assessmentMonth() != null) return calculateMonthly(request);
        TenantPrincipal principal = prepare();
        TemplateHeader header = templateHeader(principal, request.templateVersionId());
        List<IndicatorRow> rules = indicators(principal, request.templateVersionId());
        OtaKpiSnapshotReader.SourceHotel hotel = sourceHotels().stream()
                .filter(item -> item.hotelId().equals(request.sourceHotelId())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "未找到当前租户可读取的 OTA 门店快照"));
        SourceAggregate aggregate = SourceAggregate.from(hotel.snapshots());
        if (aggregate.businessDays() == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "该 OTA 门店尚无可用于试算的经营快照");
        }

        boolean candidateEligible = false;
        List<Map<String, Object>> indicatorResults = new ArrayList<>();
        BigDecimal autoScore = BigDecimal.ZERO;
        BigDecimal autoMaxScore = BigDecimal.ZERO;
        int scoreable = 0;
        int pending = 0;
        for (IndicatorRow rule : rules) {
            Binding binding = resolve(rule.name());
            JsonNode formula = parseConfiguration(rule.formulaConfig());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("section", rule.sectionName());
            item.put("indicatorCode", rule.indicatorCode());
            item.put("name", rule.name());
            item.put("maxScore", rule.maxScore());
            item.put("sourceMetricCode", binding.metricCode());
            item.put("sourceLabel", binding.label());
            if (false && ("OCCUPANCY_95_STORE_SHARE".equals(rule.indicatorCode())
                    || "OCCUPANCY_EXTRA_SCORE".equals(rule.indicatorCode()))) {
                BigDecimal actual = aggregate.occupancy();
                item.put("sourceMetricCode", "PMS_MONTHLY_OCCUPANCY");
                item.put("sourceLabel", "PMS上月整月出租率");
                item.put("actualValue", actual);
                item.put("displayValue", formatPercent(actual));
                if (!candidateEligible || actual == null) {
                    item.put("state", "PENDING_VERIFICATION");
                    item.put("reason", "本门店上月数据尚未通过月度完整性校验");
                } else {
                    BigDecimal threshold = "OCCUPANCY_95_STORE_SHARE".equals(rule.indicatorCode())
                            ? new BigDecimal("0.95") : new BigDecimal("0.98");
                    item.put("selectedStoreThreshold", threshold);
                    item.put("selectedStorePassed", actual.compareTo(threshold) >= 0);
                    item.put("state", "RESPONSIBILITY_SCOPE_AGGREGATION_PENDING");
                    item.put("evidence", hotel.hotelCode() + " · " + hotel.hotelName() + "："
                            + aggregate.businessDays() + "天，出租房晚" + plain(aggregate.roomNights())
                            + " ÷ 有效可售房晚" + plain(aggregate.sellableRooms()));
                    item.put("reason", "本店阈值结果已判定；OTA运营经理板块必须汇总其全部责任门店，不能用单店代替整组得分");
                }
                pending++;
            } else if (binding.kind() == BindingKind.OCCUPANCY) {
                BigDecimal actual = aggregate.occupancy();
                if (actual == null) {
                    item.put("state", "PENDING_VERIFICATION");
                    item.put("reason", "OTA 快照缺少可核验的出租房晚和可售房数");
                    pending++;
                } else {
                    KpiImportedTierEvaluator.Evaluation evaluation = tierEvaluator.evaluate(formula, actual, "RATIO");
                    item.put("actualValue", actual);
                    item.put("displayValue", formatPercent(actual));
                    item.put("evidence", aggregate.businessDays() + "个营业日：出租房晚" + plain(aggregate.roomNights())
                            + " ÷ 可售房数" + plain(aggregate.sellableRooms()));
                    item.put("definitionWarning", "现有快照未提供可独立证明“已排除钟点房”的字段，正式入账前需完成 PMS 口径验收");
                    if (evaluation.calculable()) {
                        item.put("state", "CALCULATED_WITH_WARNING");
                        item.put("score", evaluation.score());
                        item.put("matchedTier", evaluation.matchedTier());
                        autoScore = autoScore.add(evaluation.score());
                        autoMaxScore = autoMaxScore.add(rule.maxScore());
                        scoreable++;
                    } else {
                        item.put("state", "RULE_PENDING");
                        item.put("reason", evaluation.reason());
                        pending++;
                    }
                }
            } else if (binding.kind() == BindingKind.REVENUE_TARGET) {
                item.put("state", "CONFIGURATION_REQUIRED");
                item.put("actualValue", aggregate.roomRevenue());
                item.put("displayValue", currency(aggregate.roomRevenue()));
                item.put("reason", "已取到房费收入，但缺少该门店当月 GMV 目标，不能把原始收入直接当成完成率");
                pending++;
            } else if (binding.kind() == BindingKind.EXTERNAL_SOURCE) {
                item.put("state", "DATA_SOURCE_NOT_CONNECTED");
                item.put("reason", binding.reason());
                pending++;
            } else {
                item.put("state", "MANUAL_OR_OTHER_SYSTEM");
                item.put("reason", "该指标不是当前 OTA/PMS 经营快照可客观评价的数据");
                pending++;
            }
            indicatorResults.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("previewOnly", true);
        result.put("officialScoreEligible", false);
        result.put("templateVersionId", request.templateVersionId());
        result.put("templateTitle", header.title());
        result.put("templateLifecycleStatus", header.lifecycleStatus());
        result.put("sourceMode", "READ_ONLY_EXISTING_SNAPSHOT");
        result.put("sourceHotel", hotelItem(hotel));
        result.put("window", Map.of("from", aggregate.from(), "to", aggregate.to(), "businessDays", aggregate.businessDays()));
        result.put("freshnessState", freshness(hotel.latest()));
        result.put("completenessState", completeness(hotel.snapshots()));
        result.put("sourceMetrics", sourceMetrics(aggregate));
        result.put("automaticScore", autoScore);
        result.put("automaticMaxScore", autoMaxScore);
        result.put("baseFullScore", header.baseFullScore());
        result.put("scoreableIndicators", scoreable);
        result.put("pendingIndicators", pending);
        result.put("indicators", indicatorResults);
        result.put("warnings", List.of(
                "当前只读快照截至" + aggregate.to() + "，不是当前月完整数据",
                "试算结果不会写入指标事实、周考核单或月考核单",
                "缺少数据源、门店目标或量化规则的项目均保持待处理，不按0分"
        ));
        return result;
    }

    private Map<String, Object> calculateMonthly(KpiModels.CalculateSourcePreview request) {
        TenantPrincipal principal = prepare();
        TemplateHeader header = templateHeader(principal, request.templateVersionId());
        List<IndicatorRow> rules = indicators(principal, request.templateVersionId());
        OtaKpiSnapshotReader.SourceHotel hotel = sourceHotels().stream()
                .filter(item -> item.hotelId().equals(request.sourceHotelId())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "未找到当前租户可读取的OTA门店"));

        LocalDate assessmentMonth = request.assessmentMonth().withDayOfMonth(1);
        YearMonth sourceMonth = YearMonth.from(assessmentMonth.minusMonths(1));
        LocalDate sourceFrom = sourceMonth.atDay(1);
        LocalDate sourceTo = sourceMonth.atEndOfMonth();
        PmsMonthlyKpiReader.MonthlySummary monthly = monthlySummaryPath.isBlank() ? null
                : monthlyReader.latest(Path.of(monthlySummaryPath), hotel.hotelId(), sourceFrom, sourceTo).orElse(null);
        SourceAggregate aggregate = monthly == null
                ? SourceAggregate.from(hotel.snapshots().stream()
                    .filter(item -> within(item.businessDate(), sourceFrom, sourceTo)).toList())
                : SourceAggregate.from(monthly);
        boolean candidateEligible = monthly != null && monthly.candidateEligible();
        boolean officialEligible = monthly != null
                && monthly.candidateEligible()
                && monthly.officialScoreEligible()
                && "PMS_DIRECT_OVERNIGHT_OCCUPANCY".equals(monthly.denominatorSource())
                && "VERIFIED_DIRECT_OVERNIGHT_OCCUPANCY".equals(monthly.hourlyRoomExclusionState())
                && "NUMERICALLY_VALIDATED".equals(monthly.accuracyState());

        List<Map<String, Object>> indicatorResults = new ArrayList<>();
        BigDecimal automaticScore = BigDecimal.ZERO;
        BigDecimal automaticMaxScore = BigDecimal.ZERO;
        BigDecimal candidateScore = BigDecimal.ZERO;
        BigDecimal candidateMaxScore = BigDecimal.ZERO;
        int scoreable = 0;
        int candidateScoreable = 0;
        int pending = 0;
        for (IndicatorRow rule : rules) {
            Binding binding = resolve(rule.name());
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("section", rule.sectionName());
            item.put("indicatorCode", rule.indicatorCode());
            item.put("name", rule.name());
            item.put("maxScore", rule.maxScore());
            item.put("sourceMetricCode", binding.metricCode());
            item.put("sourceLabel", binding.label());
            if ("OCCUPANCY_95_STORE_SHARE".equals(rule.indicatorCode())
                    || "OCCUPANCY_EXTRA_SCORE".equals(rule.indicatorCode())) {
                BigDecimal actual = aggregate.occupancy();
                item.put("sourceMetricCode", "PMS_MONTHLY_OCCUPANCY");
                item.put("sourceLabel", "PMS上月整月出租率");
                item.put("actualValue", actual);
                item.put("displayValue", formatPercent(actual));
                if (!candidateEligible || actual == null) {
                    item.put("state", "PENDING_VERIFICATION");
                    item.put("reason", "本门店上月数据尚未通过月度完整性校验");
                } else {
                    BigDecimal threshold = "OCCUPANCY_95_STORE_SHARE".equals(rule.indicatorCode())
                            ? new BigDecimal("0.95") : new BigDecimal("0.98");
                    item.put("selectedStoreThreshold", threshold);
                    item.put("selectedStorePassed", actual.compareTo(threshold) >= 0);
                    item.put("state", "RESPONSIBILITY_SCOPE_AGGREGATION_PENDING");
                    item.put("evidence", hotel.hotelCode() + " · " + hotel.hotelName() + "："
                            + aggregate.businessDays() + "天，出租房晚" + plain(aggregate.roomNights())
                            + " ÷ 有效可售房晚" + plain(aggregate.sellableRooms()));
                    item.put("reason", "本店阈值结果已判定；OTA运营经理板块必须汇总其全部责任门店，不能用单店代替整组得分");
                }
                pending++;
            } else if (binding.kind() == BindingKind.OCCUPANCY) {
                BigDecimal actual = aggregate.occupancy();
                item.put("actualValue", actual);
                item.put("displayValue", formatPercent(actual));
                if (!candidateEligible || actual == null) {
                    item.put("state", "PENDING_VERIFICATION");
                    item.put("reason", monthly == null
                            ? "未取得该门店完整上一个自然月的PMS脱敏月度汇总"
                            : "上月数据未通过完整性、重复、数值或月合计交叉校验，暂不计分");
                    pending++;
                } else {
                    KpiImportedTierEvaluator.Evaluation evaluation = tierEvaluator.evaluate(
                            parseConfiguration(rule.formulaConfig()), actual, "RATIO");
                    if (officialEligible && "VERIFIED_DIRECT_OVERNIGHT_OCCUPANCY".equals(monthly.hourlyRoomExclusionState())) {
                        item.put("evidence", "美团PMS《JY07经理报表(月报)(固化)》直出“过夜房出租率”："
                                + formatPercent(actual) + "（不计钟点房）");
                    } else {
                        item.put("evidence", aggregate.businessDays() + "个营业日：出租房晚"
                                + plain(aggregate.roomNights()) + " ÷ 有效可售房晚"
                                + plain(aggregate.sellableRooms()));
                        item.put("definitionWarning", "PMS历史月报未提供可独立证明‘已排除钟点房’的字段；当前为候选得分，口径验收后才能转正式分");
                    }
                    if (!evaluation.calculable()) {
                        item.put("state", "RULE_PENDING");
                        item.put("reason", evaluation.reason());
                        pending++;
                    } else if (officialEligible) {
                        item.put("state", "CALCULATED");
                        item.put("score", evaluation.score());
                        item.put("matchedTier", evaluation.matchedTier());
                        automaticScore = automaticScore.add(evaluation.score());
                        automaticMaxScore = automaticMaxScore.add(rule.maxScore());
                        scoreable++;
                    } else {
                        item.put("state", "CANDIDATE_CALCULATED_DEFINITION_PENDING");
                        item.put("candidateScore", evaluation.score());
                        item.put("matchedTier", evaluation.matchedTier());
                        candidateScore = candidateScore.add(evaluation.score());
                        candidateMaxScore = candidateMaxScore.add(rule.maxScore());
                        candidateScoreable++;
                    }
                }
            } else if (binding.kind() == BindingKind.REVENUE_TARGET) {
                item.put("state", "CONFIGURATION_REQUIRED");
                item.put("actualValue", aggregate.roomRevenue());
                item.put("displayValue", currency(aggregate.roomRevenue()));
                item.put("reason", "已取得上月房费收入，但缺少该门店该月目标值，暂不计算目标完成率");
                pending++;
            } else if (binding.kind() == BindingKind.EXTERNAL_SOURCE) {
                item.put("state", "DATA_SOURCE_NOT_CONNECTED");
                item.put("reason", binding.reason());
                pending++;
            } else {
                item.put("state", "MANUAL_OR_OTHER_SYSTEM");
                item.put("reason", "该指标不属于当前PMS经营月报可客观评价的数据");
                pending++;
            }
            indicatorResults.add(item);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("previewOnly", true);
        result.put("officialScoreEligible", officialEligible);
        result.put("scoreState", officialEligible ? "OFFICIAL_CALCULABLE"
                : candidateEligible ? "CANDIDATE_DEFINITION_PENDING" : "PENDING_DATA_VALIDATION");
        result.put("assessmentMonth", assessmentMonth);
        result.put("sourceDataMonth", sourceMonth.toString());
        result.put("templateVersionId", request.templateVersionId());
        result.put("templateTitle", header.title());
        result.put("templateLifecycleStatus", header.lifecycleStatus());
        result.put("sourceMode", monthly == null ? "READ_ONLY_EXISTING_SNAPSHOT"
                : "READ_ONLY_LIVE_PMS_MONTHLY_SUMMARY");
        result.put("sourceHotel", hotelItem(hotel));
        result.put("window", Map.of("from", sourceFrom, "to", sourceTo,
                "businessDays", aggregate.businessDays()));
        result.put("freshnessState", monthly == null ? freshness(hotel.latest()) : freshness(monthly.collectedAt()));
        result.put("completenessState", candidateEligible ? "COMPLETE_MONTH_VALIDATED" : "INCOMPLETE_OR_INVALID");
        result.put("validation", monthlyValidation(monthly));
        result.put("sourceMetrics", sourceMetrics(aggregate));
        result.put("automaticScore", automaticScore);
        result.put("automaticMaxScore", automaticMaxScore);
        result.put("candidateScore", candidateScore);
        result.put("candidateMaxScore", candidateMaxScore);
        result.put("baseFullScore", header.baseFullScore());
        result.put("scoreableIndicators", scoreable);
        result.put("candidateScoreableIndicators", candidateScoreable);
        result.put("pendingIndicators", pending);
        result.put("indicators", indicatorResults);
        List<String> warnings = new ArrayList<>();
        warnings.add("考核月" + assessmentMonth + "固定读取上一个自然月" + sourceMonth + "，不读取本月累计值");
        warnings.add(officialEligible
                ? "月度出租率直接读取PMS上月JY07月报‘过夜房出租率’，不计钟点房，也不平均每日出租率"
                : "月度出租率按累计分子÷累计分母重算，不平均每日出租率");
        warnings.add("试算结果不会写入指标事实、周考核单、月考核单或工资结算");
        if (!officialEligible) warnings.add("钟点房剔除字段语义尚未完成PMS口径验收，候选得分不得作为正式工资依据");
        result.put("warnings", warnings);
        return result;
    }

    private boolean within(String value, LocalDate from, LocalDate to) {
        try {
            LocalDate date = LocalDate.parse(value);
            return !date.isBefore(from) && !date.isAfter(to);
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private Map<String, Object> monthlyValidation(PmsMonthlyKpiReader.MonthlySummary monthly) {
        if (monthly == null) return Map.of("state", "MONTHLY_SUMMARY_UNAVAILABLE");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("coverageState", monthly.coverageState());
        result.put("expectedDayCount", monthly.expectedDayCount());
        result.put("validDistinctDayCount", monthly.validDistinctDayCount());
        result.put("missingDayCount", monthly.missingDayCount());
        result.put("duplicateDayCount", monthly.duplicateDayCount());
        result.put("numericState", monthly.numericState());
        result.put("aggregateCrosscheckState", monthly.aggregateCrosscheckState());
        result.put("denominatorSource", monthly.denominatorSource());
        result.put("roomCapacity", monthly.roomCapacity());
        result.put("capacityEvidenceState", monthly.capacityEvidenceState());
        result.put("hourlyRoomExclusionState", monthly.hourlyRoomExclusionState());
        result.put("accuracyState", monthly.accuracyState());
        result.put("evidenceHash", monthly.responseContentSha256());
        return result;
    }

    private List<OtaKpiSnapshotReader.SourceHotel> sourceHotels() {
        if (snapshotPath.isBlank() || hotelDirectoryPath.isBlank()) return List.of();
        return snapshotReader.read(Path.of(hotelDirectoryPath), Path.of(snapshotPath), allowedTenantCode);
    }

    private TemplateHeader templateHeader(TenantPrincipal principal, UUID id) {
        List<TemplateHeader> rows = jdbc.query("""
                select v.base_full_score, sv.title, sv.lifecycle_status
                from kpi_template_version v
                join standard_version sv on sv.tenant_id = v.tenant_id and sv.id = v.standard_version_id
                where v.tenant_id = :tenantId and v.id = :id
                """, base(principal).addValue("id", id), (rs, rowNum) -> new TemplateHeader(
                rs.getString("title"), rs.getString("lifecycle_status"), rs.getBigDecimal("base_full_score")));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "KPI 模板版本不存在");
        return rows.getFirst();
    }

    private List<IndicatorRow> indicators(TenantPrincipal principal, UUID id) {
        return jdbc.query("""
                select s.name as section_name, i.indicator_code, i.name, i.max_score,
                       i.indicator_type, i.formula_config::text as formula_config
                from kpi_template_section s
                join kpi_indicator_rule i on i.tenant_id = s.tenant_id and i.section_id = s.id
                where s.tenant_id = :tenantId and s.template_version_id = :id
                order by s.sort_order, i.sort_order, i.indicator_code
                """, base(principal).addValue("id", id), (rs, rowNum) -> new IndicatorRow(
                rs.getString("section_name"), rs.getString("indicator_code"), rs.getString("name"),
                rs.getBigDecimal("max_score"), rs.getString("indicator_type"), rs.getString("formula_config")));
    }

    private Map<String, Object> hotelItem(OtaKpiSnapshotReader.SourceHotel hotel) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("hotelId", hotel.hotelId());
        result.put("hotelCode", hotel.hotelCode());
        result.put("hotelName", hotel.hotelName());
        result.put("snapshotAvailable", !hotel.snapshots().isEmpty());
        if (hotel.latest() != null) {
            result.put("latestBusinessDate", hotel.latest().businessDate());
            result.put("latestObservedAt", hotel.latest().observedAt());
            result.put("freshnessState", freshness(hotel.latest()));
            result.put("businessDayCount", hotel.snapshots().size());
        }
        result.put("middlePlatformStoreBindingState", "UNBOUND_PREVIEW_SOURCE");
        return result;
    }

    private List<Map<String, Object>> sourceMetrics(SourceAggregate value) {
        return List.of(
                metric("OCCUPANCY", "出租率", value.occupancy(), formatPercent(value.occupancy()), "RATIO"),
                metric("ROOM_REVENUE", "房费收入", value.roomRevenue(), currency(value.roomRevenue()), "CURRENCY"),
                metric("ADR", "平均房价 ADR", value.adr(), currency(value.adr()), "CURRENCY"),
                metric("REVPAR", "每可售房收入 RevPAR", value.revPar(), currency(value.revPar()), "CURRENCY"),
                metric("SOLD_ROOM_NIGHTS", "出租房晚", value.roomNights(), plain(value.roomNights()), "ROOM_NIGHT"),
                metric("SELLABLE_ROOMS", "可售房数", value.sellableRooms(), plain(value.sellableRooms()), "ROOM")
        );
    }

    private Map<String, Object> metric(String code, String name, BigDecimal value, String display, String unit) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("code", code);
        result.put("name", name);
        result.put("value", value);
        result.put("displayValue", display);
        result.put("unit", unit);
        result.put("state", value == null ? "PENDING_VERIFICATION" : "AVAILABLE_WITH_WARNING");
        return result;
    }

    private String freshness(OtaKpiSnapshotReader.LatestSnapshot snapshot) {
        if (snapshot == null) return "UNAVAILABLE";
        return freshness(snapshot.observedAt());
    }

    private String freshness(OffsetDateTime observedAt) {
        if (observedAt == null) return "UNAVAILABLE";
        Duration age = Duration.between(observedAt.toInstant(), OffsetDateTime.now(ZoneOffset.UTC).toInstant());
        return age.isNegative() || age.compareTo(Duration.ofHours(36)) <= 0 ? "FRESH" : "STALE";
    }

    private String completeness(List<OtaKpiSnapshotReader.LatestSnapshot> snapshots) {
        return snapshots.stream().allMatch(item -> "COMPLETE".equalsIgnoreCase(item.completeness()))
                ? "COMPLETE" : "PARTIAL";
    }

    private Binding resolve(String name) {
        String normalized = name == null ? "" : name.replace(" ", "").toUpperCase(Locale.ROOT);
        if (normalized.equals("出租率") || normalized.contains("出租率达成")) {
            return new Binding(BindingKind.OCCUPANCY, "OCCUPANCY", "PMS出租率", null);
        }
        if (normalized.equals("GMV") || normalized.contains("营业额") || normalized.contains("营收目标")) {
            return new Binding(BindingKind.REVENUE_TARGET, "ROOM_REVENUE_TARGET_PROGRESS", "房费收入目标完成率", null);
        }
        if (normalized.contains("好评") || normalized.contains("差评") || normalized.contains("OTA")
                || normalized.contains("扫码住") || normalized.contains("渠道排名") || normalized.contains("线上排名")
                || normalized.contains("运营管理")) {
            return new Binding(BindingKind.EXTERNAL_SOURCE, "OTA_CHANNEL_DATA", "OTA渠道评价/排名数据",
                    "需要接入对应门店、对应渠道的评价或排名接口；当前 PMS 经营快照不含该字段");
        }
        if (normalized.contains("质检") || normalized.contains("卫生") || normalized.contains("查房")
                || normalized.contains("清扫质量") || normalized.contains("客房质量")) {
            return new Binding(BindingKind.EXTERNAL_SOURCE, "QMS_DATA", "质检系统数据",
                    "需要接入质检/巡检系统的客观记录，不能从 OTA 经营快照推断");
        }
        if (normalized.contains("培训") || normalized.contains("考试")) {
            return new Binding(BindingKind.EXTERNAL_SOURCE, "TRAINING_DATA", "培训考试数据",
                    "需要接入培训签到和考试成绩记录");
        }
        return new Binding(BindingKind.MANUAL, null, "人工评价或其他系统", null);
    }

    private JsonNode parseConfiguration(String raw) {
        if (raw == null || raw.isBlank()) return JsonNodeFactory.instance.objectNode();
        try {
            JsonNode value = objectMapper.readTree(raw);
            for (int depth = 0; depth < 3 && value.isObject() && value.path("value").isTextual(); depth++) {
                value = objectMapper.readTree(value.path("value").asText());
            }
            return value;
        } catch (JsonProcessingException ignored) {
            return JsonNodeFactory.instance.objectNode();
        }
    }

    private TenantPrincipal prepare() {
        accessPolicy.requirePermission("kpi.template.read");
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private String formatPercent(BigDecimal value) {
        return value == null ? "待核验" : value.multiply(HUNDRED).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString() + "%";
    }

    private String currency(BigDecimal value) {
        return value == null ? "待核验" : "¥" + value.setScale(2, RoundingMode.HALF_UP).toPlainString();
    }

    private String plain(BigDecimal value) {
        return value == null ? "待核验" : value.stripTrailingZeros().toPlainString();
    }

    private record TemplateHeader(String title, String lifecycleStatus, BigDecimal baseFullScore) {
    }

    private record IndicatorRow(String sectionName, String indicatorCode, String name,
                                BigDecimal maxScore, String indicatorType, String formulaConfig) {
    }

    private enum BindingKind { OCCUPANCY, REVENUE_TARGET, EXTERNAL_SOURCE, MANUAL }

    private record Binding(BindingKind kind, String metricCode, String label, String reason) {
    }

    private record SourceAggregate(String from, String to, int businessDays, BigDecimal sellableRooms,
                                   BigDecimal roomNights, BigDecimal roomRevenue, BigDecimal occupancy,
                                   BigDecimal adr, BigDecimal revPar) {
        static SourceAggregate from(List<OtaKpiSnapshotReader.LatestSnapshot> snapshots) {
            List<OtaKpiSnapshotReader.LatestSnapshot> usable = snapshots.stream()
                    .filter(item -> item.overview() != null).sorted(Comparator.comparing(OtaKpiSnapshotReader.LatestSnapshot::businessDate)).toList();
            BigDecimal sellable = sum(usable, item -> item.overview().roomCount());
            BigDecimal nights = sum(usable, item -> item.overview().roomNights() == null
                    ? item.overview().soldRooms() : item.overview().roomNights());
            BigDecimal revenue = sum(usable, item -> item.overview().roomFee() == null
                    ? item.overview().revenue() : item.overview().roomFee());
            BigDecimal occupancy = divide(nights, sellable, 6);
            BigDecimal adr = divide(revenue, nights, 2);
            BigDecimal revPar = divide(revenue, sellable, 2);
            String from = usable.isEmpty() ? "" : usable.getFirst().businessDate();
            String to = usable.isEmpty() ? "" : usable.getLast().businessDate();
            return new SourceAggregate(from, to, usable.size(), sellable, nights, revenue, occupancy, adr, revPar);
        }

        static SourceAggregate from(PmsMonthlyKpiReader.MonthlySummary monthly) {
            return new SourceAggregate(monthly.from().toString(), monthly.to().toString(),
                    monthly.validDistinctDayCount(), monthly.effectiveSellableRoomNights(),
                    monthly.overnightSoldRoomNights(), monthly.roomRevenue(), monthly.occupancyRate(),
                    monthly.adr(), monthly.revPar());
        }

        private static BigDecimal sum(List<OtaKpiSnapshotReader.LatestSnapshot> rows,
                                      java.util.function.Function<OtaKpiSnapshotReader.LatestSnapshot, BigDecimal> extractor) {
            BigDecimal total = BigDecimal.ZERO;
            boolean found = false;
            for (OtaKpiSnapshotReader.LatestSnapshot row : rows) {
                BigDecimal value = extractor.apply(row);
                if (value != null) {
                    total = total.add(value);
                    found = true;
                }
            }
            return found ? total : null;
        }

        private static BigDecimal divide(BigDecimal numerator, BigDecimal denominator, int scale) {
            return numerator == null || denominator == null || denominator.compareTo(BigDecimal.ZERO) <= 0
                    ? null : numerator.divide(denominator, scale, RoundingMode.HALF_UP);
        }
    }
}
