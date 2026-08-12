package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

class KpiScoringEngineTest {
    private final KpiScoringEngine engine = new KpiScoringEngine();

    @Test
    void ratioTargetKeepsSameWeeklyTargetAndRequiresAllStoresForFullScore() {
        UUID ruleId = UUID.randomUUID();
        UUID metricId = UUID.randomUUID();
        var formula = JsonNodeFactory.instance.objectNode()
                .put("scoreMode", "PROPORTIONAL")
                .put("metricNature", "RATIO");
        var rule = new KpiModels.TemplateRule(ruleId, "OPERATING_RESULT", "OCCUPANCY_SHARE", "达标门店占比",
                "TARGET", "SAME_TARGET", metricId, new BigDecimal("20"), BigDecimal.ZERO,
                BigDecimal.ONE, false, 2, false, "SYSTEM", "PENDING_VERIFICATION",
                formula, JsonNodeFactory.instance.objectNode());

        var result = engine.score(List.of(rule), Map.of(metricId,
                new KpiModels.MetricAggregate("AVAILABLE", new BigDecimal("0.95"), null, null,
                        6, JsonNodeFactory.instance.objectNode())), Map.of(), true, 1);

        assertEquals(new BigDecimal("19.0000"), result.finalScore());
        assertFalse(result.pendingVerification());
    }

    @Test
    void cumulativeTotalCanSplitIntoFixedFourWeeksButRateCannotBeImplicitlySplit() {
        UUID ruleId = UUID.randomUUID();
        UUID metricId = UUID.randomUUID();
        var formula = JsonNodeFactory.instance.objectNode().put("scoreMode", "PROPORTIONAL");
        var rule = new KpiModels.TemplateRule(ruleId, "SALES", "SALES_TOTAL", "累计销售量",
                "TARGET", "EQUAL_FOUR_WEEKS", metricId, new BigDecimal("20"), BigDecimal.ZERO,
                new BigDecimal("100"), false, 2, false, "SYSTEM", "PENDING_VERIFICATION",
                formula, JsonNodeFactory.instance.objectNode());

        var result = engine.score(List.of(rule), Map.of(metricId,
                new KpiModels.MetricAggregate("AVAILABLE", new BigDecimal("25"), null, null,
                        1, JsonNodeFactory.instance.objectNode())), Map.of(), true, 2);

        assertEquals(new BigDecimal("20.0000"), result.finalScore());
        assertEquals(new BigDecimal("25.00000000"), result.indicators().getFirst().targetValue());
    }

    @Test
    void eventDeductionSupportsNegativeScoreWhenNoTemplateFloorIsConfigured() {
        UUID ruleId = UUID.randomUUID();
        UUID metricId = UUID.randomUUID();
        var formula = JsonNodeFactory.instance.objectNode().put("deductionPerEvent", 1);
        var rule = new KpiModels.TemplateRule(ruleId, "INSPECTION", "INSPECTION_EVENTS", "巡检",
                "EVENT_DEDUCTION", "SAME_TARGET", metricId, new BigDecimal("25"), null,
                BigDecimal.ZERO, false, 2, true, "SYSTEM", "PENDING_VERIFICATION",
                formula, JsonNodeFactory.instance.objectNode());

        var result = engine.score(List.of(rule), Map.of(metricId,
                new KpiModels.MetricAggregate("AVAILABLE", new BigDecimal("30"), null, null,
                        30, JsonNodeFactory.instance.objectNode())), Map.of(), false, null);

        assertEquals(new BigDecimal("-5.0000"), result.finalScore());
    }

    @Test
    void missingMetricRemainsPendingInsteadOfBecomingZero() {
        var rule = new KpiModels.TemplateRule(UUID.randomUUID(), "RESULT", "RESULT", "经营结果",
                "TARGET", "SAME_TARGET", UUID.randomUUID(), new BigDecimal("20"), BigDecimal.ZERO,
                BigDecimal.ONE, false, 2, false, "SYSTEM", "PENDING_VERIFICATION",
                JsonNodeFactory.instance.objectNode(), JsonNodeFactory.instance.objectNode());

        var result = engine.score(List.of(rule), Map.of(), Map.of(), false, null);

        assertEquals(BigDecimal.ZERO.setScale(4), result.finalScore());
        assertEquals("PENDING", result.indicators().getFirst().outcome());
        assertEquals(true, result.pendingVerification());
    }
}
