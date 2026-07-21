package cn.sifangguan.hotelaios.evaluations;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeterministicEvaluationEngineTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DeterministicEvaluationEngine engine = new DeterministicEvaluationEngine();

    @Test
    void failsWhenRequiredItemIsMissingEvenAtPassScore() throws Exception {
        var items = objectMapper.readTree("""
                [
                  {"code":"greeting","required":true,"weight":20},
                  {"code":"identity","required":true,"weight":80}
                ]
                """);
        var scoring = objectMapper.readTree("{" + "\"passScore\":80,\"fullScore\":100" + "}");
        var input = objectMapper.readTree("{" + "\"identity\":true" + "}");

        DeterministicEvaluationEngine.Result result = engine.evaluate(items, scoring, input);

        assertThat(result.score()).isEqualByComparingTo("80.00");
        assertThat(result.outcome()).isEqualTo("FAIL");
        assertThat(result.executionStatus()).isEqualTo("COMPLETED");
    }

    @Test
    void reservesManualAndAiItemsForHumanDecisionInSprintTwo() throws Exception {
        var items = objectMapper.readTree("""
                [{"code":"photoQuality","mode":"AI_RESERVED","weight":100}]
                """);
        var scoring = objectMapper.readTree("{" + "\"passScore\":80,\"fullScore\":100" + "}");
        var input = objectMapper.readTree("{" + "\"photoQuality\":\"uploaded\"" + "}");

        DeterministicEvaluationEngine.Result result = engine.evaluate(items, scoring, input);

        assertThat(result.outcome()).isEqualTo("PENDING");
        assertThat(result.executionStatus()).isEqualTo("PENDING_MANUAL");
        assertThat(result.items()).singleElement().extracting(DeterministicEvaluationEngine.ItemResult::mode)
                .isEqualTo("AI_RESERVED");
    }
}
