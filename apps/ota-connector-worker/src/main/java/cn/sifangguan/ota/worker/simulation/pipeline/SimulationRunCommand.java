package cn.sifangguan.ota.worker.simulation.pipeline;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.UUID;

public record SimulationRunCommand(
        TenantHotelRef scope,
        String hotelName,
        SimulationScenarioCode scenarioCode,
        UUID simulationRunId,
        SimulationHotelConfiguration configuration) {
    public SimulationRunCommand {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(hotelName, "hotelName");
        Objects.requireNonNull(scenarioCode, "scenarioCode");
        Objects.requireNonNull(simulationRunId, "simulationRunId");
        Objects.requireNonNull(configuration, "configuration");
        if (hotelName.isBlank()) {
            throw new IllegalArgumentException("hotelName must not be blank");
        }
    }

    public SimulationRunCommand(TenantHotelRef scope, String hotelName) {
        this(scope, hotelName, SimulationScenarioCode.BASELINE);
    }

    public SimulationRunCommand(
            TenantHotelRef scope,
            String hotelName,
            SimulationScenarioCode scenarioCode) {
        this(
                scope,
                hotelName,
                scenarioCode,
                UUID.nameUUIDFromBytes(
                        ("simulation-command|" + scope.tenantId() + "|"
                                + scope.hotelId() + "|" + scenarioCode)
                                .getBytes(StandardCharsets.UTF_8)),
                cn.sifangguan.ota.worker.simulation.fixture
                        .BuiltInSimulationFixture.defaultConfiguration());
    }
}
