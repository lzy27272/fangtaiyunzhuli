package cn.sifangguan.hotelaios.performance;

import org.springframework.stereotype.Component;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Component
final class SimpleXlsxReader {
    private static final int MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
    private static final int MAX_ROWS = 2000;
    private static final int MAX_COLUMNS = 100;

    List<Map<String, String>> read(byte[] bytes) {
        WorkbookData workbook = readWorkbook(bytes);
        if (workbook.sheets().isEmpty()) throw new IllegalArgumentException("Excel文件不包含工作表");
        List<List<String>> rows = workbook.sheets().getFirst().rows();
        if (rows.isEmpty()) return List.of();
        List<String> headers = normalizedHeaders(rows.getFirst());
        List<Map<String, String>> result = new ArrayList<>();
        for (int index = 1; index < rows.size(); index++) {
            List<String> row = rows.get(index);
            Map<String, String> record = new LinkedHashMap<>();
            boolean hasValue = false;
            for (int column = 0; column < headers.size(); column++) {
                String value = column < row.size() ? row.get(column).trim() : "";
                record.put(headers.get(column), value);
                hasValue |= !value.isBlank();
            }
            if (hasValue) result.add(record);
        }
        return List.copyOf(result);
    }

    WorkbookData readWorkbook(byte[] bytes) {
        Map<String, byte[]> entries = unzip(bytes);
        List<String> sharedStrings = sharedStrings(entries.get("xl/sharedStrings.xml"));
        byte[] workbookBytes = entries.get("xl/workbook.xml");
        byte[] relationshipBytes = entries.get("xl/_rels/workbook.xml.rels");
        List<SheetData> sheets = new ArrayList<>();
        if (workbookBytes != null && relationshipBytes != null) {
            Map<String, String> targets = relationshipTargets(relationshipBytes);
            NodeList sheetNodes = xml(workbookBytes).getElementsByTagNameNS("*", "sheet");
            for (int index = 0; index < sheetNodes.getLength(); index++) {
                Element sheet = (Element) sheetNodes.item(index);
                String relationshipId = sheet.getAttributeNS(
                        "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
                if (relationshipId.isBlank()) relationshipId = sheet.getAttribute("r:id");
                String target = targets.get(relationshipId);
                String path = workbookTarget(target);
                byte[] sheetBytes = path == null ? null : entries.get(path);
                if (sheetBytes != null) {
                    sheets.add(new SheetData(sheet.getAttribute("name"), parseSheet(sheetBytes, sharedStrings)));
                }
            }
        }
        if (sheets.isEmpty()) {
            byte[] firstSheet = entries.get("xl/worksheets/sheet1.xml");
            if (firstSheet == null) throw new IllegalArgumentException("Excel文件不包含可读取的工作表");
            sheets.add(new SheetData("Sheet1", parseSheet(firstSheet, sharedStrings)));
        }
        return new WorkbookData(List.copyOf(sheets));
    }

    private Map<String, byte[]> unzip(byte[] bytes) {
        Map<String, byte[]> result = new HashMap<>();
        int total = 0;
        try (ZipInputStream input = new ZipInputStream(new ByteArrayInputStream(bytes))) {
            ZipEntry entry;
            while ((entry = input.getNextEntry()) != null) {
                String name = entry.getName().replace('\\', '/');
                if (name.contains("..") || name.startsWith("/")) {
                    throw new IllegalArgumentException("Excel压缩包包含非法路径");
                }
                byte[] content = input.readAllBytes();
                total += content.length;
                if (total > MAX_UNCOMPRESSED_BYTES) throw new IllegalArgumentException("Excel解压内容超过50MB限制");
                if (name.equals("xl/sharedStrings.xml") || name.equals("xl/workbook.xml")
                        || name.equals("xl/_rels/workbook.xml.rels")
                        || name.startsWith("xl/worksheets/") && name.endsWith(".xml")) {
                    result.put(name, content);
                }
            }
        } catch (Exception exception) {
            if (exception instanceof IllegalArgumentException illegal) throw illegal;
            throw new IllegalArgumentException("无法读取Excel文件", exception);
        }
        return result;
    }

    private Map<String, String> relationshipTargets(byte[] bytes) {
        NodeList relationships = xml(bytes).getElementsByTagNameNS("*", "Relationship");
        Map<String, String> result = new HashMap<>();
        for (int index = 0; index < relationships.getLength(); index++) {
            Element relationship = (Element) relationships.item(index);
            String type = relationship.getAttribute("Type");
            if (type.endsWith("/worksheet")) {
                result.put(relationship.getAttribute("Id"), relationship.getAttribute("Target"));
            }
        }
        return result;
    }

    private String workbookTarget(String target) {
        if (target == null || target.isBlank()) return null;
        String normalized = target.replace('\\', '/');
        if (normalized.startsWith("/")) normalized = normalized.substring(1);
        if (normalized.startsWith("xl/")) return normalized;
        while (normalized.startsWith("../")) normalized = normalized.substring(3);
        return "xl/" + normalized;
    }

    private List<String> sharedStrings(byte[] bytes) {
        if (bytes == null) return List.of();
        Document document = xml(bytes);
        NodeList items = document.getElementsByTagNameNS("*", "si");
        List<String> result = new ArrayList<>();
        for (int index = 0; index < items.getLength(); index++) {
            Element item = (Element) items.item(index);
            NodeList texts = item.getElementsByTagNameNS("*", "t");
            StringBuilder value = new StringBuilder();
            for (int textIndex = 0; textIndex < texts.getLength(); textIndex++) {
                value.append(texts.item(textIndex).getTextContent());
            }
            result.add(value.toString());
        }
        return result;
    }

    private List<List<String>> parseSheet(byte[] bytes, List<String> sharedStrings) {
        Document document = xml(bytes);
        NodeList rowNodes = document.getElementsByTagNameNS("*", "row");
        if (rowNodes.getLength() > MAX_ROWS) throw new IllegalArgumentException("Excel最多支持2000行");
        List<List<String>> rows = new ArrayList<>();
        for (int rowIndex = 0; rowIndex < rowNodes.getLength(); rowIndex++) {
            Element rowElement = (Element) rowNodes.item(rowIndex);
            int rowNumber = numericIndex(rowElement.getAttribute("r"), rowIndex + 1);
            if (rowNumber > MAX_ROWS) throw new IllegalArgumentException("Excel最多支持2000行");
            while (rows.size() < rowNumber - 1) rows.add(new ArrayList<>());
            NodeList cells = rowElement.getElementsByTagNameNS("*", "c");
            List<String> row = new ArrayList<>();
            for (int cellIndex = 0; cellIndex < cells.getLength(); cellIndex++) {
                Element cell = (Element) cells.item(cellIndex);
                int column = columnIndex(cell.getAttribute("r"));
                if (column >= MAX_COLUMNS) throw new IllegalArgumentException("Excel最多支持100列");
                while (row.size() <= column) row.add("");
                String type = cell.getAttribute("t");
                String value;
                if ("inlineStr".equals(type)) {
                    NodeList text = cell.getElementsByTagNameNS("*", "t");
                    value = text.getLength() == 0 ? "" : text.item(0).getTextContent();
                } else {
                    NodeList values = cell.getElementsByTagNameNS("*", "v");
                    value = values.getLength() == 0 ? "" : values.item(0).getTextContent();
                    if ("s".equals(type) && !value.isBlank()) {
                        int sharedIndex = Integer.parseInt(value);
                        value = sharedIndex >= 0 && sharedIndex < sharedStrings.size() ? sharedStrings.get(sharedIndex) : "";
                    }
                }
                row.set(column, value == null ? "" : value);
            }
            rows.add(row);
        }
        NodeList mergedCells = document.getElementsByTagNameNS("*", "mergeCell");
        for (int index = 0; index < mergedCells.getLength(); index++) {
            String reference = ((Element) mergedCells.item(index)).getAttribute("ref");
            applyMergedCell(rows, reference);
        }
        return rows;
    }

    private void applyMergedCell(List<List<String>> rows, String reference) {
        String[] bounds = reference.split(":", 2);
        if (bounds.length != 2) return;
        int startColumn = columnIndex(bounds[0]);
        int endColumn = columnIndex(bounds[1]);
        int startRow = rowIndex(bounds[0]);
        int endRow = rowIndex(bounds[1]);
        if (startColumn < 0 || endColumn >= MAX_COLUMNS || startRow < 0 || endRow >= MAX_ROWS
                || startRow >= rows.size()) return;
        List<String> sourceRow = rows.get(startRow);
        String value = startColumn < sourceRow.size() ? sourceRow.get(startColumn) : "";
        for (int row = startRow; row <= endRow; row++) {
            while (rows.size() <= row) rows.add(new ArrayList<>());
            List<String> targetRow = rows.get(row);
            while (targetRow.size() <= endColumn) targetRow.add("");
            for (int column = startColumn; column <= endColumn; column++) {
                targetRow.set(column, value);
            }
        }
    }

    private List<String> normalizedHeaders(List<String> raw) {
        List<String> result = new ArrayList<>();
        Map<String, Integer> seen = new HashMap<>();
        for (int index = 0; index < raw.size(); index++) {
            String base = raw.get(index).trim();
            if (base.isBlank()) base = "column_" + (index + 1);
            String key = base.toLowerCase(Locale.ROOT);
            int count = seen.merge(key, 1, Integer::sum);
            result.add(count == 1 ? base : base + "_" + count);
        }
        return result;
    }

    private int columnIndex(String reference) {
        int value = 0;
        int index = 0;
        while (index < reference.length() && Character.isLetter(reference.charAt(index))) {
            value = value * 26 + (Character.toUpperCase(reference.charAt(index)) - 'A' + 1);
            index++;
        }
        return Math.max(0, value - 1);
    }

    private int rowIndex(String reference) {
        int index = 0;
        while (index < reference.length() && Character.isLetter(reference.charAt(index))) index++;
        return Math.max(0, numericIndex(reference.substring(index), 1) - 1);
    }

    private int numericIndex(String value, int fallback) {
        try {
            return value == null || value.isBlank() ? fallback : Integer.parseInt(value);
        } catch (NumberFormatException exception) {
            return fallback;
        }
    }

    private Document xml(byte[] bytes) {
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setNamespaceAware(true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            return factory.newDocumentBuilder().parse(new ByteArrayInputStream(bytes));
        } catch (Exception exception) {
            throw new IllegalArgumentException("Excel XML结构无效", exception);
        }
    }

    record WorkbookData(List<SheetData> sheets) {
    }

    record SheetData(String name, List<List<String>> rows) {
    }
}
