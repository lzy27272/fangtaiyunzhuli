package cn.sifangguan.ota.api.sprint1.catalog;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Server-owned adapter registry for Sprint 1. No client supplied class name,
 * URL, script, SQL, or filesystem path is ever interpreted as an adapter.
 */
public final class ConnectorAdapterDirectory {
    private final List<AdapterSummary> adapters;
    private final Map<String, AdapterSummary> byCode;

    public ConnectorAdapterDirectory() {
        adapters = List.of(
                new AdapterSummary(
                        "MOCK_PMS", "模拟 PMS", "PMS", true,
                        List.of("BUSINESS_DAY", "ROOM_REVENUE", "INVENTORY")),
                new AdapterSummary(
                        "MOCK_CTRIP", "模拟携程", "CTRIP", true,
                        List.of("ORDER_ROOM_NIGHT", "INVENTORY")),
                new AdapterSummary(
                        "MOCK_MEITUAN", "模拟美团", "MEITUAN", true,
                        List.of("ORDER_ROOM_NIGHT", "INVENTORY")),
                new AdapterSummary(
                        "FILE_FIXTURE", "内置只读测试夹具", "OFFICIAL_EXPORT", true,
                        List.of("BUSINESS_DAY", "ROOM_REVENUE", "ORDER_ROOM_NIGHT", "INVENTORY"))
        );
        byCode = adapters.stream().collect(Collectors.toUnmodifiableMap(
                AdapterSummary::code, Function.identity()));
    }

    public List<AdapterSummary> list() {
        return adapters;
    }

    public Optional<AdapterSummary> find(String code) {
        if (code == null) {
            return Optional.empty();
        }
        return Optional.ofNullable(byCode.get(code.toUpperCase(Locale.ROOT)));
    }

    public AdapterSummary require(String code) {
        return find(code).orElseThrow(() -> new IllegalArgumentException(
                "Only server-registered Sprint 1 adapters are allowed"));
    }

    public record AdapterSummary(
            String code,
            String displayName,
            String sourceSystem,
            boolean simulationOnly,
            List<String> streams
    ) {
        public AdapterSummary {
            streams = List.copyOf(streams);
        }
    }
}
