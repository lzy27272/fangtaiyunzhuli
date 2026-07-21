package cn.sifangguan.hotelaios.rules;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RuleConditionEvaluatorTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final RuleConditionEvaluator evaluator = new RuleConditionEvaluator();

    @Test
    void evaluatesTypedNestedConditionAndReturnsTrace() throws Exception {
        var condition = objectMapper.readTree("""
                {"op":"ALL","children":[
                  {"op":"GTE","fact":"ota.score","value":4.9},
                  {"op":"ANY","children":[
                    {"op":"EQ","fact":"complaint.level","value":"MAJOR"},
                    {"op":"EXISTS","fact":"complaint.escalatedAt"}
                  ]}
                ]}
                """);
        var facts = objectMapper.readTree("""
                {"ota":{"score":4.92},"complaint":{"level":"MAJOR"}}
                """);

        RuleConditionEvaluator.Evaluation result = evaluator.evaluate(condition, facts);

        assertThat(result.matched()).isTrue();
        assertThat(result.trace()).isNotEmpty();
    }

    @Test
    void rejectsScriptLikeOrUnknownOperator() throws Exception {
        var condition = objectMapper.readTree("""
                {"op":"SPEL","value":"T(java.lang.Runtime).getRuntime()"}
                """);

        assertThatThrownBy(() -> evaluator.validate(condition))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不支持的操作符");
    }
}
