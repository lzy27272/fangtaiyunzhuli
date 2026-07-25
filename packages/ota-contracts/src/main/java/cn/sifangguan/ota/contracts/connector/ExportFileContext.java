package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.collection.EvidenceReference;
import cn.sifangguan.ota.contracts.common.TenantHotelRef;

import java.util.Objects;
import java.util.UUID;

public record ExportFileContext(
        TenantHotelRef scope,
        UUID importBatchId,
        EvidenceReference evidenceReference) {
    public ExportFileContext {
        Objects.requireNonNull(scope, "scope");
        Objects.requireNonNull(importBatchId, "importBatchId");
        Objects.requireNonNull(evidenceReference, "evidenceReference");
    }
}
