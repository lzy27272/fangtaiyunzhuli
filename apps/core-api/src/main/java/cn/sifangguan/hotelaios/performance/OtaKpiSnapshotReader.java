package cn.sifangguan.hotelaios.performance;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.core.JsonToken;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Component
final class OtaKpiSnapshotReader {
    private final ObjectMapper objectMapper;
    private Cache cache;

    OtaKpiSnapshotReader(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    synchronized List<SourceHotel> read(Path directoryPath, Path snapshotPath, String allowedTenantCode) {
        if (directoryPath == null || snapshotPath == null || !Files.isRegularFile(directoryPath)
                || !Files.isRegularFile(snapshotPath) || allowedTenantCode == null || allowedTenantCode.isBlank()) {
            return List.of();
        }
        try {
            long directoryModified = Files.getLastModifiedTime(directoryPath).toMillis();
            long snapshotModified = Files.getLastModifiedTime(snapshotPath).toMillis();
            if (cache != null && cache.matches(directoryPath, snapshotPath, allowedTenantCode,
                    directoryModified, snapshotModified)) return cache.hotels();
            Map<String, HotelDirectory> directory = readDirectory(directoryPath, allowedTenantCode);
            Map<String, List<LatestSnapshot>> snapshots = readSnapshots(snapshotPath);
            List<SourceHotel> hotels = new ArrayList<>();
            directory.values().forEach(item -> hotels.add(new SourceHotel(item.tenantCode(), item.hotelId(),
                    item.hotelCode(), item.hotelName(), item.pmsProviderCode(), item.sourceProfile(),
                    item.sourceConnectionState(), item.sourceConnectionMessage(),
                    snapshots.getOrDefault(item.hotelId(), List.of()))));
            List<SourceHotel> immutable = List.copyOf(hotels);
            cache = new Cache(directoryPath, snapshotPath, allowedTenantCode, directoryModified, snapshotModified, immutable);
            return immutable;
        } catch (IOException exception) {
            throw new IllegalStateException("无法读取本地 OTA 经营快照", exception);
        }
    }

    private Map<String, HotelDirectory> readDirectory(Path path, String allowedTenantCode) throws IOException {
        JsonNode root = objectMapper.readTree(path.toFile());
        Map<String, HotelDirectory> result = new LinkedHashMap<>();
        if (!root.isArray()) return result;
        for (JsonNode hotel : root) {
            String tenantCode = hotel.path("tenantCode").asText("");
            String hotelId = hotel.path("hotelId").asText("");
            if (!allowedTenantCode.equals(tenantCode) || hotelId.isBlank()) continue;
            result.put(hotelId, new HotelDirectory(tenantCode, hotelId, hotel.path("hotelCode").asText(""),
                    hotel.path("hotelName").asText(hotelId), hotel.path("pmsProviderCode").asText("UNCONFIGURED"),
                    hotel.path("sourceProfile").asText(""),
                    hotel.path("sourceConnectionState").asText("UNCONFIGURED"),
                    hotel.path("sourceConnectionMessage").asText("数据源尚未配置")));
        }
        return result;
    }

    private Map<String, List<LatestSnapshot>> readSnapshots(Path path) throws IOException {
        Map<String, List<LatestSnapshot>> result = new LinkedHashMap<>();
        try (JsonParser parser = objectMapper.getFactory().createParser(path.toFile())) {
            if (parser.nextToken() != JsonToken.START_OBJECT) return result;
            while (parser.nextToken() != JsonToken.END_OBJECT) {
                String hotelId = parser.currentName();
                if (parser.nextToken() != JsonToken.START_ARRAY) {
                    parser.skipChildren();
                    continue;
                }
                Map<String, LatestSnapshot> latestByBusinessDate = new LinkedHashMap<>();
                while (parser.nextToken() != JsonToken.END_ARRAY) {
                    if (parser.currentToken() != JsonToken.START_OBJECT) {
                        parser.skipChildren();
                        continue;
                    }
                    LatestSnapshot candidate = readSnapshot(parser, hotelId);
                    if (candidate != null) {
                        String businessDate = candidate.businessDate() == null
                                ? candidate.observedAt().toLocalDate().toString() : candidate.businessDate();
                        LatestSnapshot existing = latestByBusinessDate.get(businessDate);
                        if (existing == null || candidate.observedAt().isAfter(existing.observedAt())) {
                            latestByBusinessDate.put(businessDate, candidate);
                        }
                    }
                }
                if (!latestByBusinessDate.isEmpty()) {
                    List<LatestSnapshot> snapshots = latestByBusinessDate.values().stream()
                            .sorted(java.util.Comparator.comparing(LatestSnapshot::businessDate)).toList();
                    result.put(hotelId, snapshots);
                }
            }
        }
        return result;
    }

    private LatestSnapshot readSnapshot(JsonParser parser, String keyHotelId) throws IOException {
        String hotelId = keyHotelId;
        String businessDate = null;
        OffsetDateTime observedAt = null;
        String completeness = null;
        Overview overview = null;
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            String field = parser.currentName();
            JsonToken valueToken = parser.nextToken();
            if ("hotelId".equals(field)) hotelId = parser.getValueAsString(keyHotelId);
            else if ("businessDate".equals(field)) businessDate = parser.getValueAsString();
            else if ("observedAt".equals(field)) observedAt = offsetDateTime(parser.getValueAsString());
            else if ("completeness".equals(field)) completeness = parser.getValueAsString();
            else if ("overview".equals(field) && valueToken == JsonToken.START_OBJECT) overview = readOverview(parser);
            else parser.skipChildren();
        }
        if (observedAt == null) return null;
        return new LatestSnapshot(hotelId, businessDate, observedAt, completeness, overview);
    }

    private Overview readOverview(JsonParser parser) throws IOException {
        BigDecimal roomCount = null;
        BigDecimal availableRooms = null;
        BigDecimal soldRooms = null;
        BigDecimal roomNights = null;
        BigDecimal roomFee = null;
        BigDecimal revenue = null;
        BigDecimal occupancyRate = null;
        BigDecimal adr = null;
        BigDecimal revPar = null;
        while (parser.nextToken() != JsonToken.END_OBJECT) {
            String field = parser.currentName();
            parser.nextToken();
            BigDecimal value = decimal(parser);
            if ("roomCount".equals(field)) roomCount = value;
            else if ("availableRooms".equals(field)) availableRooms = value;
            else if ("soldRooms".equals(field)) soldRooms = value;
            else if ("roomNights".equals(field)) roomNights = value;
            else if ("roomFee".equals(field)) roomFee = value;
            else if ("revenue".equals(field)) revenue = value;
            else if ("occupancyRate".equals(field)) occupancyRate = value;
            else if ("adr".equals(field)) adr = value;
            else if ("revPar".equals(field)) revPar = value;
            parser.skipChildren();
        }
        return new Overview(roomCount, availableRooms, soldRooms, roomNights, roomFee, revenue,
                occupancyRate, adr, revPar);
    }

    private BigDecimal decimal(JsonParser parser) throws IOException {
        if (parser.currentToken() == JsonToken.VALUE_NUMBER_INT || parser.currentToken() == JsonToken.VALUE_NUMBER_FLOAT) {
            return parser.getDecimalValue();
        }
        if (parser.currentToken() == JsonToken.VALUE_STRING) {
            try {
                return new BigDecimal(parser.getValueAsString());
            } catch (NumberFormatException ignored) {
                return null;
            }
        }
        return null;
    }

    private OffsetDateTime offsetDateTime(String value) {
        try {
            return value == null ? null : OffsetDateTime.parse(value);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    record SourceHotel(String tenantCode, String hotelId, String hotelCode, String hotelName,
                       String pmsProviderCode, String sourceProfile, String sourceConnectionState,
                       String sourceConnectionMessage,
                       List<LatestSnapshot> snapshots) {
        LatestSnapshot latest() {
            return snapshots.stream().max(java.util.Comparator.comparing(LatestSnapshot::observedAt)).orElse(null);
        }
    }

    record LatestSnapshot(String hotelId, String businessDate, OffsetDateTime observedAt,
                          String completeness, Overview overview) {
    }

    record Overview(BigDecimal roomCount, BigDecimal availableRooms, BigDecimal soldRooms,
                    BigDecimal roomNights, BigDecimal roomFee, BigDecimal revenue,
                    BigDecimal occupancyRate, BigDecimal adr, BigDecimal revPar) {
        BigDecimal normalizedOccupancy() {
            if (roomCount != null && soldRooms != null && roomCount.compareTo(BigDecimal.ZERO) > 0) {
                return soldRooms.divide(roomCount, 6, java.math.RoundingMode.HALF_UP);
            }
            if (occupancyRate == null) return null;
            return occupancyRate.compareTo(BigDecimal.ONE) > 0
                    ? occupancyRate.divide(BigDecimal.valueOf(100), 6, java.math.RoundingMode.HALF_UP)
                    : occupancyRate;
        }
    }

    private record HotelDirectory(String tenantCode, String hotelId, String hotelCode, String hotelName,
                                  String pmsProviderCode, String sourceProfile, String sourceConnectionState,
                                  String sourceConnectionMessage) {
    }

    private record Cache(Path directoryPath, Path snapshotPath, String tenantCode, long directoryModified,
                         long snapshotModified, List<SourceHotel> hotels) {
        boolean matches(Path directory, Path snapshots, String tenant, long directoryTime, long snapshotTime) {
            return directoryPath.equals(directory) && snapshotPath.equals(snapshots) && tenantCode.equals(tenant)
                    && directoryModified == directoryTime && snapshotModified == snapshotTime;
        }
    }
}
