package cn.sifangguan.ota.worker.fixture;

import cn.sifangguan.ota.worker.sprint2.contract.ConnectorContractExecutionPreflight;

public final class TestConnectorContractExecutionPreflight {
    private TestConnectorContractExecutionPreflight() {
    }

    public static ConnectorContractExecutionPreflight allowIsolatedFixture() {
        return (job, connector) -> {
            // Isolated unit fixtures have no database-approved connector version.
        };
    }
}
