package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.collection.CollectionRequest;

import java.util.Objects;

public record ExportParseRequest(
        ExportFileContext file,
        CollectionRequest collectionRequest) {
    public ExportParseRequest {
        Objects.requireNonNull(file, "file");
        Objects.requireNonNull(collectionRequest, "collectionRequest");
    }
}
