package cn.sifangguan.ota.api.sprint2.intake;

import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Objects;
import java.util.UUID;

import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.AdmissionState;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorAdmissionModels.ConnectorContractAdmissionView;
import static cn.sifangguan.ota.api.sprint2.intake.Sprint2ConnectorIntakeModels.SourceCode;

/**
 * Reads only inert configuration drafts. It deliberately does not read
 * fingerprints, SecretStore bindings or runtime state tables.
 */
public final class JdbcConnectorAdmissionReadinessPort
        implements ConnectorAdmissionReadinessPort {
    static final String LIST_READINESS_SQL = """
            select connector.tenant_id,
                   connector.hotel_id,
                   connector.connector_id,
                   connector.source_type,
                   connector.adapter_code,
                   version.connector_version_id,
                   version.adapter_version
              from ota.hotel_source_connector connector
              join lateral (
                  select connector_version_id, adapter_version
                    from ota.hotel_source_connector_version
                   where tenant_id = connector.tenant_id
                     and hotel_id = connector.hotel_id
                     and connector_id = connector.connector_id
                     and status = 'DRAFT'
                   order by version_no desc
                   limit 1
              ) version on true
             where connector.hotel_id = ?
               and connector.connector_mode = 'CONFIGURATION_ONLY'
               and connector.lifecycle_status = 'DRAFT'
             order by connector.source_type, connector.connector_id
            """;

    private static final List<String> BLOCKERS = List.of(
            "SERVER_OWNED_CONTRACT_CANDIDATE_UNAVAILABLE",
            "CONFIGURATION_ONLY_NOT_EXECUTABLE");

    private final JdbcTemplate jdbc;

    public JdbcConnectorAdmissionReadinessPort(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
    }

    @Override
    public List<ConnectorContractAdmissionView> listReadiness(UUID hotelId) {
        Objects.requireNonNull(hotelId, "hotelId");
        return jdbc.query(
                LIST_READINESS_SQL,
                (resultSet, rowNumber) -> new ConnectorContractAdmissionView(
                        resultSet.getObject("tenant_id", UUID.class),
                        resultSet.getObject("hotel_id", UUID.class),
                        resultSet.getObject("connector_id", UUID.class),
                        resultSet.getObject("connector_version_id", UUID.class),
                        SourceCode.valueOf(resultSet.getString("source_type")),
                        resultSet.getString("adapter_code"),
                        resultSet.getString("adapter_version"),
                        AdmissionState.CANDIDATE_UNAVAILABLE,
                        false,
                        false,
                        false,
                        true,
                        0,
                        BLOCKERS),
                hotelId);
    }
}
