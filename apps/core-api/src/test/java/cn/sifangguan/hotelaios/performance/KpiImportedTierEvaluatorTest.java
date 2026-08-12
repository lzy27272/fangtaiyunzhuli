package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

class KpiImportedTierEvaluatorTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final KpiImportedTierEvaluator evaluator = new KpiImportedTierEvaluator();

    @Test
    void calculatesImportedOccupancyBand() throws Exception {
        var config = objectMapper.readTree("""
                {"scoreTiers":[
                  {"target":"1","score":10},
                  {"target":"95%-98%","score":8},
                  {"target":"90%-94%","score":5},
                  {"target":"85%-89%","score":3}
                ]}
                """);

        var result = evaluator.evaluate(config, new BigDecimal("0.9574"), "RATIO");

        assertThat(result.calculable()).isTrue();
        assertThat(result.score()).isEqualByComparingTo("8");
        assertThat(result.matchedTier()).isEqualTo("95%-98%");
    }

    @Test
    void integerPercentRangeCoversDecimalPercentWithinThatBand() throws Exception {
        var config = objectMapper.readTree("""
                {"scoreTiers":[{"target":"85%-89%","score":3}]}
                """);

        var result = evaluator.evaluate(config, new BigDecimal("0.8947"), "RATIO");

        assertThat(result.calculable()).isTrue();
        assertThat(result.score()).isEqualByComparingTo("3");
    }

    @Test
    void refusesToGuessWhenImportedBandsHaveAGap() throws Exception {
        var config = objectMapper.readTree("""
                {"scoreTiers":[
                  {"target":"1","score":10},
                  {"target":"95%-98%","score":8}
                ]}
                """);

        var result = evaluator.evaluate(config, new BigDecimal("0.9907"), "RATIO");

        assertThat(result.calculable()).isFalse();
        assertThat(result.reason()).contains("空档");
    }
}
