package cn.sifangguan.ota.contracts.collection;

import java.time.Instant;

/**
 * Marker contract for a typed normalized source record. Implementations must remain DTOs and
 * must never contain credential, cookie, token, webhook, or other secret material.
 */
public interface StandardRecord {
    String recordType();

    String sourceRecordKey();

    Instant sourceUpdatedAt();
}
