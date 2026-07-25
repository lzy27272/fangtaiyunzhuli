package cn.sifangguan.ota.api.sprint1.catalog;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ConnectorAdapterDirectoryTest {
    @Test
    void exposesOnlyFourCodeOwnedSimulationAdapters() {
        ConnectorAdapterDirectory directory = new ConnectorAdapterDirectory();

        assertThat(directory.list())
                .extracting(ConnectorAdapterDirectory.AdapterSummary::code)
                .containsExactly("MOCK_PMS", "MOCK_CTRIP", "MOCK_MEITUAN", "FILE_FIXTURE");
        assertThat(directory.list()).allMatch(ConnectorAdapterDirectory.AdapterSummary::simulationOnly);
        assertThat(directory.require("FILE_FIXTURE").sourceSystem()).isEqualTo("OFFICIAL_EXPORT");
    }

    @Test
    void rejectsClientSelectedImplementationNamesOrUrls() {
        ConnectorAdapterDirectory directory = new ConnectorAdapterDirectory();

        assertThatThrownBy(() -> directory.require("https://example.test/adapter"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> directory.require("com.example.ArbitraryAdapter"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
