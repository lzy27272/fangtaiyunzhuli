package cn.sifangguan.ota.worker.simulation.domain;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

public final class SimulationTaskFactory {
    public List<SimulationTask> create(List<InventoryIncident> incidents) {
        Objects.requireNonNull(incidents, "incidents");
        return incidents.stream()
                .map(incident -> new SimulationTask(
                        UUID.nameUUIDFromBytes(
                                ("simulation-task|" + incident.incidentId())
                                        .getBytes(StandardCharsets.UTF_8)),
                        incident.incidentId(),
                        "P1",
                        "OPEN",
                        incident.detectedAt(),
                        incident.detectedAt().plusSeconds(600)))
                .toList();
    }
}
