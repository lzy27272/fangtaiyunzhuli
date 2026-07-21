package cn.sifangguan.hotelaios.workdata;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FormPayloadValidatorTest {
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final FormPayloadValidator validator = new FormPayloadValidator();

    @Test
    void draftMayOmitRequiredFieldsButStillRejectsInvalidPresentValues() throws Exception {
        JsonNode schema = objectMapper.readTree("""
                {
                  "type":"object",
                  "required":["summary","roomCount"],
                  "additionalProperties":false,
                  "properties":{
                    "summary":{"type":"string","minLength":3},
                    "roomCount":{"type":"integer","minimum":1},
                    "nested":{
                      "type":"object",
                      "required":["comment"],
                      "properties":{"comment":{"type":"string","minLength":2}}
                    }
                  }
                }
                """);

        assertThatCode(() -> validator.requireValidDraft(schema, objectMapper.readTree("{}")))
                .doesNotThrowAnyException();
        assertThatCode(() -> validator.requireValidDraft(schema, objectMapper.readTree("{\"nested\":{}}")))
                .doesNotThrowAnyException();
        assertThatThrownBy(() -> validator.requireValidDraft(schema, objectMapper.readTree("{\"roomCount\":0}")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("roomCount");
    }

    @Test
    void finalSubmissionStillRequiresEveryPublishedSchemaField() throws Exception {
        JsonNode schema = objectMapper.readTree("""
                {"type":"object","required":["summary"],"properties":{"summary":{"type":"string"}}}
                """);

        assertThatThrownBy(() -> validator.requireValid(schema, objectMapper.readTree("{}")))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("summary");
    }
}
