package cn.sifangguan.ota.worker.simulation.connector;

import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Clock;
import java.util.Set;

public final class SimulationPmsConnector extends AbstractSimulationConnector {
    /**
     * Must match the server-owned adapter code persisted by the standalone API.
     * The registry therefore works for both the deterministic pipeline and a
     * dynamically scheduled collection job.
     */
    public static final String CONNECTOR_CODE = "MOCK_PMS";

    public SimulationPmsConnector(Clock clock) {
        super(new ConnectorDescriptor(
                CONNECTOR_CODE,
                SourceSystem.PMS,
                "sprint1-fixture-v1",
                Set.of(
                        ConnectorCapability.PMS_BUSINESS_DATE,
                        ConnectorCapability.INVENTORY_BY_ROOM_TYPE,
                        ConnectorCapability.ROOM_REVENUE_AGGREGATE,
                        ConnectorCapability.OVERNIGHT_SOLD,
                        ConnectorCapability.EFFECTIVE_SELLABLE_TOTAL,
                        ConnectorCapability.SOURCE_UPDATED_AT),
                Set.of(
                        DataStreamType.BUSINESS_DATE,
                        DataStreamType.INVENTORY_ROOM_TYPE,
                        DataStreamType.ROOM_REVENUE_AGGREGATE),
                false),
                clock);
    }
}
