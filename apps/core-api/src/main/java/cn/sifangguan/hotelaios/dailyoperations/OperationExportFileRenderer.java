package cn.sifangguan.hotelaios.dailyoperations;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Dependency-free renderer for completed daily-operation export jobs.
 *
 * <p>The renderer deliberately accepts already-authorized rows. As a final
 * defense in depth, evidence marked sensitive is omitted unless the request
 * explicitly includes sensitive data.</p>
 */
public final class OperationExportFileRenderer {
    private static final byte[] UTF_8_BOM = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    private static final String CSV_MEDIA_TYPE = "text/csv; charset=UTF-8";
    private static final String XLSX_MEDIA_TYPE =
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final String PDF_MEDIA_TYPE = "application/pdf";
    private static final long ZIP_ENTRY_TIME = 315_532_800_000L;
    private static final int EXCEL_CELL_LIMIT = 32_767;
    private static final int EXCEL_DATA_ROW_LIMIT = 1_048_575;

    public RenderedFile render(
            String exportType,
            LocalDate businessDate,
            String orgName,
            boolean includeSensitive,
            List<DetailRow> detailRows,
            List<EvidenceRow> evidenceRows
    ) {
        String normalizedType = normalizeExportType(exportType);
        LocalDate requiredDate = Objects.requireNonNull(businessDate, "businessDate is required");
        String normalizedOrgName = displayOrgName(orgName);
        List<DetailRow> details = nonNullRows(detailRows);
        List<EvidenceRow> evidence = visibleEvidence(evidenceRows, includeSensitive);
        String baseName = "daily-operations-" + requiredDate + "-" + fileSlug(normalizedOrgName);

        return switch (normalizedType) {
            case "CSV_DETAIL", "CSV" -> new RenderedFile(
                    baseName + "-detail.csv",
                    CSV_MEDIA_TYPE,
                    renderDetailCsv(requiredDate, normalizedOrgName, details));
            case "EVIDENCE_LIST" -> new RenderedFile(
                    baseName + "-evidence.csv",
                    CSV_MEDIA_TYPE,
                    renderEvidenceCsv(requiredDate, normalizedOrgName, evidence));
            case "EXCEL_DETAIL", "XLSX" -> new RenderedFile(
                    baseName + "-detail.xlsx",
                    XLSX_MEDIA_TYPE,
                    renderDetailXlsx(requiredDate, normalizedOrgName, details));
            case "PDF_SUMMARY", "PDF" -> new RenderedFile(
                    baseName + "-summary.pdf",
                    PDF_MEDIA_TYPE,
                    renderSummaryPdf(requiredDate, normalizedOrgName, includeSensitive, details, evidence));
            default -> throw new IllegalArgumentException("Unsupported export type: " + exportType);
        };
    }

    private static byte[] renderDetailCsv(
            LocalDate businessDate,
            String orgName,
            List<DetailRow> rows
    ) {
        List<List<String>> table = new ArrayList<>(rows.size() + 1);
        table.add(List.of(
                "Business Date", "Organization", "Record Type", "Record ID", "Reference No",
                "Org Unit ID", "Status", "Level", "Title", "Description", "Created At"));
        for (DetailRow row : rows) {
            table.add(List.of(
                    businessDate.toString(), orgName, value(row.recordType()), value(row.recordId()),
                    value(row.referenceNo()), value(row.orgUnitId()), value(row.status()), value(row.level()),
                    value(row.title()), value(row.description()), value(row.createdAt())));
        }
        return csvBytes(table);
    }

    private static byte[] renderEvidenceCsv(
            LocalDate businessDate,
            String orgName,
            List<EvidenceRow> rows
    ) {
        List<List<String>> table = new ArrayList<>(rows.size() + 1);
        table.add(List.of(
                "Business Date", "Organization", "Source Type", "Source ID", "Evidence Type",
                "File Name", "Media Type", "Size Bytes", "SHA-256", "Status", "Sensitivity",
                "Occurred At"));
        for (EvidenceRow row : rows) {
            table.add(List.of(
                    businessDate.toString(), orgName, value(row.sourceType()), value(row.sourceId()),
                    value(row.evidenceType()), value(row.fileName()), value(row.mediaType()),
                    value(row.sizeBytes()), value(row.sha256()), value(row.status()),
                    value(row.sensitivity()), value(row.occurredAt())));
        }
        return csvBytes(table);
    }

    private static byte[] csvBytes(List<List<String>> rows) {
        StringBuilder csv = new StringBuilder(Math.max(256, rows.size() * 128));
        for (List<String> row : rows) {
            for (int column = 0; column < row.size(); column++) {
                if (column > 0) {
                    csv.append(',');
                }
                csv.append(csvCell(row.get(column)));
            }
            csv.append("\r\n");
        }
        byte[] body = csv.toString().getBytes(StandardCharsets.UTF_8);
        byte[] result = new byte[UTF_8_BOM.length + body.length];
        System.arraycopy(UTF_8_BOM, 0, result, 0, UTF_8_BOM.length);
        System.arraycopy(body, 0, result, UTF_8_BOM.length, body.length);
        return result;
    }

    private static String csvCell(String rawValue) {
        String safeValue = preventSpreadsheetFormula(value(rawValue));
        return '"' + safeValue.replace("\"", "\"\"") + '"';
    }

    private static String preventSpreadsheetFormula(String rawValue) {
        String cleaned = stripNul(rawValue);
        int index = 0;
        while (index < cleaned.length()) {
            char character = cleaned.charAt(index);
            if (character == ' ' || character == '\t' || character == '\r' || character == '\n'
                    || character == '\uFEFF') {
                index++;
                continue;
            }
            if (character == '=' || character == '+' || character == '-' || character == '@') {
                return "'" + cleaned;
            }
            break;
        }
        return cleaned;
    }

    private static byte[] renderDetailXlsx(
            LocalDate businessDate,
            String orgName,
            List<DetailRow> rows
    ) {
        if (rows.size() > EXCEL_DATA_ROW_LIMIT) {
            throw new IllegalArgumentException("Too many detail rows for one XLSX worksheet: " + rows.size());
        }

        List<List<String>> table = new ArrayList<>(rows.size() + 1);
        table.add(List.of(
                "Business Date", "Organization", "Record Type", "Record ID", "Reference No",
                "Org Unit ID", "Status", "Level", "Title", "Description", "Created At"));
        for (DetailRow row : rows) {
            table.add(List.of(
                    businessDate.toString(), orgName, value(row.recordType()), value(row.recordId()),
                    value(row.referenceNo()), value(row.orgUnitId()), value(row.status()), value(row.level()),
                    value(row.title()), value(row.description()), value(row.createdAt())));
        }

        String worksheet = worksheetXml(table);
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
             ZipOutputStream zip = new ZipOutputStream(bytes, StandardCharsets.UTF_8)) {
            putZipEntry(zip, "[Content_Types].xml", contentTypesXml());
            putZipEntry(zip, "_rels/.rels", packageRelationshipsXml());
            putZipEntry(zip, "xl/workbook.xml", workbookXml());
            putZipEntry(zip, "xl/_rels/workbook.xml.rels", workbookRelationshipsXml());
            putZipEntry(zip, "xl/worksheets/sheet1.xml", worksheet);
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to render XLSX", exception);
        }
    }

    private static String worksheetXml(List<List<String>> table) {
        StringBuilder xml = new StringBuilder(Math.max(1_024, table.size() * 512));
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
                .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">")
                .append("<sheetData>");
        for (int rowIndex = 0; rowIndex < table.size(); rowIndex++) {
            int excelRow = rowIndex + 1;
            xml.append("<row r=\"").append(excelRow).append("\">");
            List<String> row = table.get(rowIndex);
            for (int columnIndex = 0; columnIndex < row.size(); columnIndex++) {
                String cellReference = excelColumn(columnIndex + 1) + excelRow;
                String cellValue = truncateExcelCell(stripNul(value(row.get(columnIndex))));
                xml.append("<c r=\"").append(cellReference).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                        .append(xmlText(cellValue))
                        .append("</t></is></c>");
            }
            xml.append("</row>");
        }
        return xml.append("</sheetData></worksheet>").toString();
    }

    private static String contentTypesXml() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>
                """;
    }

    private static String packageRelationshipsXml() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>
                """;
    }

    private static String workbookXml() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="Daily Operations" sheetId="1" r:id="rId1"/></sheets>
                </workbook>
                """;
    }

    private static String workbookRelationshipsXml() {
        return """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>
                """;
    }

    private static void putZipEntry(ZipOutputStream zip, String name, String content) throws IOException {
        ZipEntry entry = new ZipEntry(name);
        entry.setTime(ZIP_ENTRY_TIME);
        zip.putNextEntry(entry);
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    private static String excelColumn(int oneBasedColumn) {
        StringBuilder result = new StringBuilder(3);
        int column = oneBasedColumn;
        while (column > 0) {
            column--;
            result.append((char) ('A' + (column % 26)));
            column /= 26;
        }
        return result.reverse().toString();
    }

    private static String truncateExcelCell(String value) {
        if (value.length() <= EXCEL_CELL_LIMIT) {
            return value;
        }
        return value.substring(0, EXCEL_CELL_LIMIT - 14) + "...[truncated]";
    }

    private static String xmlText(String value) {
        StringBuilder escaped = new StringBuilder(value.length() + 16);
        value.codePoints().forEach(codePoint -> {
            if (!isValidXmlCodePoint(codePoint)) {
                return;
            }
            switch (codePoint) {
                case '&' -> escaped.append("&amp;");
                case '<' -> escaped.append("&lt;");
                case '>' -> escaped.append("&gt;");
                case '"' -> escaped.append("&quot;");
                case '\'' -> escaped.append("&apos;");
                default -> escaped.appendCodePoint(codePoint);
            }
        });
        return escaped.toString();
    }

    private static boolean isValidXmlCodePoint(int codePoint) {
        return codePoint == 0x9 || codePoint == 0xA || codePoint == 0xD
                || (codePoint >= 0x20 && codePoint <= 0xD7FF)
                || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
                || (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
    }

    private static byte[] renderSummaryPdf(
            LocalDate businessDate,
            String orgName,
            boolean includeSensitive,
            List<DetailRow> details,
            List<EvidenceRow> evidence
    ) {
        List<String> lines = new ArrayList<>();
        lines.add("Daily Operations Summary");
        lines.add("Business date: " + businessDate);
        lines.add("Organization: " + asciiText(orgName));
        lines.add("Sensitive data included: " + (includeSensitive ? "yes" : "no"));
        lines.add("Detail records: " + details.size());
        lines.add("Evidence records: " + evidence.size());
        appendCounts(lines, "Status", details, DetailRow::status);
        appendCounts(lines, "Level", details, DetailRow::level);
        appendCounts(lines, "Evidence type", evidence, EvidenceRow::evidenceType);

        StringBuilder stream = new StringBuilder(1_024);
        stream.append("BT\n/F1 11 Tf\n14 TL\n50 790 Td\n");
        for (int index = 0; index < lines.size() && index < 48; index++) {
            if (index > 0) {
                stream.append("T*\n");
            }
            stream.append('(').append(pdfLiteral(lines.get(index))).append(") Tj\n");
        }
        stream.append("ET\n");
        byte[] content = stream.toString().getBytes(StandardCharsets.US_ASCII);

        try (ByteArrayOutputStream pdf = new ByteArrayOutputStream()) {
            writeAscii(pdf, "%PDF-1.4\n");
            int[] offsets = new int[6];
            offsets[1] = pdf.size();
            writeAscii(pdf, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
            offsets[2] = pdf.size();
            writeAscii(pdf, "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
            offsets[3] = pdf.size();
            writeAscii(pdf, "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
                    + "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
            offsets[4] = pdf.size();
            writeAscii(pdf, "4 0 obj\n<< /Length " + content.length + " >>\nstream\n");
            pdf.write(content);
            writeAscii(pdf, "endstream\nendobj\n");
            offsets[5] = pdf.size();
            writeAscii(pdf, "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

            int crossReferenceOffset = pdf.size();
            writeAscii(pdf, "xref\n0 6\n0000000000 65535 f \n");
            for (int object = 1; object <= 5; object++) {
                writeAscii(pdf, String.format(Locale.ROOT, "%010d 00000 n \n", offsets[object]));
            }
            writeAscii(pdf, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
                    + crossReferenceOffset + "\n%%EOF\n");
            return pdf.toByteArray();
        } catch (IOException exception) {
            throw new IllegalStateException("Unable to render PDF", exception);
        }
    }

    private static <T> void appendCounts(
            List<String> lines,
            String label,
            List<T> rows,
            java.util.function.Function<T, String> classifier
    ) {
        Map<String, Integer> counts = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (T row : rows) {
            String key = value(classifier.apply(row));
            counts.merge(key.isBlank() ? "(blank)" : asciiText(key), 1, Integer::sum);
        }
        int emitted = 0;
        int remainder = 0;
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            if (emitted < 10) {
                lines.add(label + " - " + entry.getKey() + ": " + entry.getValue());
                emitted++;
            } else {
                remainder += entry.getValue();
            }
        }
        if (remainder > 0) {
            lines.add(label + " - other: " + remainder);
        }
    }

    private static void writeAscii(ByteArrayOutputStream target, String value) throws IOException {
        target.write(value.getBytes(StandardCharsets.US_ASCII));
    }

    private static String pdfLiteral(String value) {
        return asciiText(value).replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)");
    }

    private static String asciiText(String value) {
        StringBuilder ascii = new StringBuilder(value.length());
        value.codePoints().forEach(codePoint -> {
            if (codePoint >= 0x20 && codePoint <= 0x7E) {
                ascii.append((char) codePoint);
            } else if (codePoint == '\t' || codePoint == '\r' || codePoint == '\n') {
                ascii.append(' ');
            } else {
                ascii.append('?');
            }
        });
        return ascii.toString();
    }

    private static String normalizeExportType(String exportType) {
        if (exportType == null || exportType.isBlank()) {
            throw new IllegalArgumentException("exportType is required");
        }
        return exportType.trim().toUpperCase(Locale.ROOT);
    }

    private static String displayOrgName(String orgName) {
        return orgName == null || orgName.isBlank() ? "all-authorized-organizations" : stripNul(orgName.trim());
    }

    private static String fileSlug(String value) {
        String normalized = Normalizer.normalize(value, Normalizer.Form.NFKD);
        StringBuilder slug = new StringBuilder(48);
        boolean separatorPending = false;
        int codePointCount = 0;
        for (int index = 0; index < normalized.length() && codePointCount < 40; ) {
            int codePoint = normalized.codePointAt(index);
            index += Character.charCount(codePoint);
            if (Character.isLetterOrDigit(codePoint)) {
                if (separatorPending && !slug.isEmpty()) {
                    slug.append('-');
                }
                slug.appendCodePoint(Character.toLowerCase(codePoint));
                separatorPending = false;
                codePointCount++;
            } else {
                separatorPending = !slug.isEmpty();
            }
        }
        return slug.isEmpty() ? "all" : slug.toString();
    }

    private static String stripNul(String value) {
        return value.replace("\u0000", "");
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    private static <T> List<T> nonNullRows(List<T> rows) {
        if (rows == null || rows.isEmpty()) {
            return List.of();
        }
        return rows.stream().filter(Objects::nonNull).toList();
    }

    private static List<EvidenceRow> visibleEvidence(List<EvidenceRow> rows, boolean includeSensitive) {
        return nonNullRows(rows).stream()
                .filter(row -> includeSensitive || !isSensitive(row.sensitivity()))
                .toList();
    }

    private static boolean isSensitive(String sensitivity) {
        if (sensitivity == null || sensitivity.isBlank()) {
            return false;
        }
        String normalized = sensitivity.trim().toUpperCase(Locale.ROOT);
        return !normalized.equals("PUBLIC")
                && !normalized.equals("INTERNAL")
                && !normalized.equals("NORMAL");
    }

    public record DetailRow(
            String recordType,
            String recordId,
            String referenceNo,
            String orgUnitId,
            String status,
            String level,
            String title,
            String description,
            String createdAt
    ) {
    }

    public record EvidenceRow(
            String sourceType,
            String sourceId,
            String evidenceType,
            String fileName,
            String mediaType,
            String sizeBytes,
            String sha256,
            String status,
            String sensitivity,
            String occurredAt
    ) {
    }

    public record RenderedFile(String fileName, String mediaType, byte[] bytes) {
        public RenderedFile {
            Objects.requireNonNull(fileName, "fileName is required");
            Objects.requireNonNull(mediaType, "mediaType is required");
            bytes = Objects.requireNonNull(bytes, "bytes are required").clone();
        }

        @Override
        public byte[] bytes() {
            return bytes.clone();
        }
    }
}
