package cn.sifangguan.ota.api.audit;

import org.junit.jupiter.api.Test;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

class CorrelationIdMapperTest {
    @Test
    void mapsNonUuidBrowserHeaderToStableUuidBeforeJdbcBinding() {
        UUID first = CorrelationIdMapper.toUuid("abc-123");
        UUID second = CorrelationIdMapper.toUuid("abc-123");

        assertThat(first).isEqualTo(second);
        assertThat(first.version()).isEqualTo(5);
    }

    @Test
    void preservesValidUuid() {
        UUID value = UUID.randomUUID();
        assertThat(CorrelationIdMapper.toUuid(value.toString())).isEqualTo(value);
    }
}
