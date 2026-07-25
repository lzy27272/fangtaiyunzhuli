package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.util.List;
import java.util.Objects;
import java.util.Optional;

public interface TenantDirectoryPort {
    Optional<HotelDirectoryEntry> findHotel(TenantHotelRef scope);

    List<HotelDirectoryEntry> listCollectionEnabledHotels();

    record HotelDirectoryEntry(
            TenantHotelRef scope,
            String hotelCode,
            String hotelName,
            boolean collectionEnabled,
            boolean messageEnabled) {
        public HotelDirectoryEntry {
            Objects.requireNonNull(scope, "scope");
            hotelCode = requireText(hotelCode, "hotelCode");
            hotelName = requireText(hotelName, "hotelName");
        }
    }

    private static String requireText(String value, String field) {
        Objects.requireNonNull(value, field);
        if (value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value;
    }
}
