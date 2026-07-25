package cn.sifangguan.ota.contracts.connector;

import cn.sifangguan.ota.contracts.collection.CollectionResult;

public interface OfficialExportParser {
    ExportDescriptor descriptor();

    ExportValidationResult validate(ExportFileContext file);

    CollectionResult parse(ExportParseRequest request);
}
