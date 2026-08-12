package cn.sifangguan.ota.api.sprint2.migration;

import java.util.List;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.PrepareCommand;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.Receipt;
import static cn.sifangguan.ota.api.sprint2.migration.CredentialMigrationModels.RehearsalView;

/**
 * Persistence boundary for a metadata-only migration rehearsal.
 *
 * Implementations must never load or return connector_secret_binding.secret_ref.
 */
public interface CredentialMigrationPort {
    List<RehearsalView> list(UUID hotelId, UUID connectorId);

    Receipt prepare(PrepareCommand command);
}
