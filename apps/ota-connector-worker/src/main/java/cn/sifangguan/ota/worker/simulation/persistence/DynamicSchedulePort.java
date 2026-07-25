package cn.sifangguan.ota.worker.simulation.persistence;

import java.time.Instant;
import java.util.UUID;

/**
 * Narrow cross-tenant scheduler boundary. The database function returns only
 * job identifiers and never connector configuration, payloads or Secret data.
 */
public interface DynamicSchedulePort {
    int dispatchDue(
            UUID schedulerServicePrincipalId,
            Instant now,
            int batchLimit);
}
