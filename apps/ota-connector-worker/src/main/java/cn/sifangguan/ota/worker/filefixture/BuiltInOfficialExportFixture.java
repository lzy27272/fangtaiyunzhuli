package cn.sifangguan.ota.worker.filefixture;

import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;
import cn.sifangguan.ota.contracts.connector.DataStreamType;
import cn.sifangguan.ota.contracts.connector.ExportFileContext;
import cn.sifangguan.ota.contracts.connector.SourceSystem;
import cn.sifangguan.ota.worker.simulation.fixture.BuiltInSimulationFixture;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Stream;

/**
 * Immutable, privacy-free official-export fixture bundled in the Worker.
 *
 * <p>The reference is an identifier for this compiled-in data set. It is not a
 * filesystem path and is never dereferenced through the network or host file
 * system.</p>
 */
public final class BuiltInOfficialExportFixture {
    public static final String REFERENCE_ID =
            "fixture://sprint1/official-export-v1";
    public static final String MEDIA_TYPE =
            "application/vnd.sifangguan.official-export-fixture+json";

    private static final byte[] MANIFEST = """
            {"fixture":"official-export-v1","privacy":"synthetic","mutable":false}
            """.strip().getBytes(StandardCharsets.UTF_8);
    public static final String SHA256 = sha256(MANIFEST);

    private BuiltInOfficialExportFixture() {
    }

    public static EvidenceReference evidence() {
        return new EvidenceReference(
                REFERENCE_ID,
                SHA256,
                MEDIA_TYPE,
                MANIFEST.length);
    }

    public static ExportFileContext fileContext(
            TenantHotelRef scope,
            UUID runId) {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(runId, "runId");
        return new ExportFileContext(
                scope,
                UUID.nameUUIDFromBytes(
                        ("official-export|" + scope.tenantId() + "|"
                                + scope.hotelId() + "|" + runId)
                                .getBytes(StandardCharsets.UTF_8)),
                evidence());
    }

    public static boolean isAvailable(EvidenceReference evidence) {
        return evidence != null
                && REFERENCE_ID.equals(evidence.referenceId())
                && SHA256.equalsIgnoreCase(evidence.sha256())
                && MEDIA_TYPE.equals(evidence.mediaType())
                && MANIFEST.length == evidence.byteLength();
    }

    public static List<StandardRecord> records(DataStreamType stream) {
        Objects.requireNonNull(stream, "stream");
        var records = switch (stream) {
            case BUSINESS_DATE, ROOM_REVENUE_AGGREGATE, INVENTORY_ROOM_TYPE ->
                    BuiltInSimulationFixture.records(SourceSystem.PMS, stream)
                            .stream();
            case BOOKING_EVENT, CANCELLATION_EVENT, INVENTORY_SELL_PRODUCT ->
                    Stream.concat(
                            BuiltInSimulationFixture.records(SourceSystem.CTRIP, stream)
                                    .stream(),
                            BuiltInSimulationFixture.records(SourceSystem.MEITUAN, stream)
                                    .stream());
            default -> Stream.empty();
        };
        return records.map(StandardRecord.class::cast).toList();
    }

    private static String sha256(byte[] value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
