package cn.sifangguan.ota.worker.simulation.connector;

import cn.sifangguan.ota.contracts.connector.ConnectorCapability;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.SourceSystem;

import java.time.Clock;
import java.util.Set;

public final class SimulationCtripConnector extends AbstractSimulationConnector {
    public static final String CONNECTOR_CODE = "MOCK_CTRIP";

    public SimulationCtripConnector(Clock clock) {
        super(new ConnectorDescriptor(
                CONNECTOR_CODE,
                SourceSystem.CTRIP,
                "sprint1-fixture-v1",
                Set.of(
                        ConnectorCapability.BOOKING_EVENTS,
                        ConnectorCapability.CANCELLATION_EVENTS,
                        ConnectorCapability.INVENTORY_BY_SELL_PRODUCT,
                        ConnectorCapability.SOURCE_UPDATED_AT),
                Set.of(
                        DataStreamType.BOOKING_EVENT,
                        DataStreamType.CANCELLATION_EVENT,
                        DataStreamType.INVENTORY_SELL_PRODUCT),
                false),
                clock);
    }
}
