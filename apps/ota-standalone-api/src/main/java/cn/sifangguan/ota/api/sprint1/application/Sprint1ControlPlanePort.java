package cn.sifangguan.ota.api.sprint1.application;

import cn.sifangguan.ota.api.sprint1.domain.Sprint1Views;
import cn.sifangguan.ota.api.tenancy.EnabledTenantDirectoryPort;
import cn.sifangguan.ota.api.tenancy.TenantConfigurationCommandHandler;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface Sprint1ControlPlanePort
        extends TenantConfigurationCommandHandler, EnabledTenantDirectoryPort {
    Optional<Sprint1Views.TenantView> findTenant(UUID tenantId);

    List<UUID> listHotelIds();

    Optional<Sprint1Views.ConfigurationView> findConfiguration(UUID tenantId, UUID hotelId);

    Optional<Sprint1Views.MonitorView> findMonitor(UUID tenantId, UUID hotelId);

    List<Sprint1Views.BriefView> listBriefs(UUID hotelId, int limit);

    List<Sprint1Views.IncidentView> listIncidents(UUID hotelId, int limit);

    List<Sprint1Views.OutboxPreview> listOutboxPreview(UUID hotelId, int limit);

    Optional<Sprint1Views.SimulationRunView> findSimulationRun(UUID hotelId, UUID runId);

    List<Sprint1Views.SimulationRunView> listSimulationRuns(UUID hotelId, int limit);

    List<Sprint1Views.SimulationHotelView> listSimulationHotels();

    boolean hasHotelScope(UUID accountId, UUID hotelId, String scopeType);
}
