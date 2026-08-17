package cn.sifangguan.hotelaios.investment;

import org.apache.fontbox.ttf.TrueTypeCollection;
import org.apache.fontbox.ttf.TrueTypeFont;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

/** Loads embedded Chinese PDF fonts on both Windows development and Ubuntu production hosts. */
final class InvestmentPdfFontLoader {
    private InvestmentPdfFontLoader() {
    }

    static FontSet load(PDDocument document) throws IOException {
        LoadedFont serif = loadFont(document, candidates("serif",
                new FontCandidate("C:/Windows/Fonts/simsun.ttc", List.of("SimSun")),
                new FontCandidate("/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
                        List.of("NotoSerifCJKsc-Regular")),
                new FontCandidate("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                        List.of("WenQuanYiZenHei"))));
        LoadedFont sans = loadFont(document, candidates("sans",
                new FontCandidate("C:/Windows/Fonts/msyh.ttc", List.of("MicrosoftYaHei")),
                new FontCandidate("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                        List.of("NotoSansCJKsc-Regular")),
                new FontCandidate("/usr/share/fonts/opentype/noto/NotoSansCJK-VF.otf.ttc",
                        List.of("NotoSansCJKsc-Regular")),
                new FontCandidate("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                        List.of("WenQuanYiZenHei"))));
        LoadedFont bold = loadFont(document, candidates("bold",
                new FontCandidate("C:/Windows/Fonts/msyhbd.ttc", List.of("MicrosoftYaHei-Bold")),
                new FontCandidate("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
                        List.of("NotoSansCJKsc-Bold")),
                new FontCandidate("/usr/share/fonts/opentype/noto/NotoSansCJK-VF.otf.ttc",
                        List.of("NotoSansCJKsc-Bold", "NotoSansCJKsc-Regular")),
                new FontCandidate("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                        List.of("WenQuanYiZenHei"))));
        return new FontSet(serif.font(), sans.font(), bold.font(),
                List.of(serif.collection(), sans.collection(), bold.collection()));
    }

    private static LoadedFont loadFont(PDDocument document, FontCandidate... candidates) throws IOException {
        List<String> attempts = new ArrayList<>();
        for (FontCandidate candidate : candidates) {
            File file = new File(candidate.path());
            if (!file.isFile()) {
                attempts.add(candidate.path() + "（文件不存在）");
                continue;
            }
            TrueTypeCollection collection = new TrueTypeCollection(file);
            try {
                TrueTypeFont font = null;
                for (String fontName : candidate.fontNames()) {
                    font = collection.getFontByName(fontName);
                    if (font != null) break;
                }
                if (font == null) {
                    attempts.add(candidate.path() + "（字体名称不匹配：" + String.join("/", candidate.fontNames()) + "）");
                    collection.close();
                    continue;
                }
                return new LoadedFont(PDType0Font.load(document, font, true), collection);
            } catch (IOException | RuntimeException exception) {
                collection.close();
                attempts.add(candidate.path() + "（" + exception.getClass().getSimpleName() + "）");
            }
        }
        throw new IOException("未找到可用的PDF中文字体：" + String.join("；", attempts));
    }

    private static FontCandidate[] candidates(String role, FontCandidate... defaults) {
        String prefix = "hotel.ai.os.pdf.font." + role;
        String overridePath = System.getProperty(prefix + ".path", "").trim();
        if (overridePath.isEmpty()) return defaults;
        List<String> overrideNames = List.of(System.getProperty(prefix + ".names", "").split(","))
                .stream()
                .map(String::trim)
                .filter(name -> !name.isEmpty())
                .toList();
        if (overrideNames.isEmpty()) {
            throw new IllegalArgumentException("PDF字体覆盖路径必须同时配置字体名称：" + prefix + ".names");
        }
        FontCandidate[] result = new FontCandidate[defaults.length + 1];
        result[0] = new FontCandidate(overridePath, overrideNames);
        System.arraycopy(defaults, 0, result, 1, defaults.length);
        return result;
    }

    private record FontCandidate(String path, List<String> fontNames) {
    }

    private record LoadedFont(PDFont font, TrueTypeCollection collection) {
    }

    record FontSet(
            PDFont serif,
            PDFont sans,
            PDFont bold,
            List<TrueTypeCollection> collections
    ) implements AutoCloseable {
        @Override
        public void close() throws IOException {
            IOException failure = null;
            for (TrueTypeCollection collection : collections) {
                try {
                    collection.close();
                } catch (IOException exception) {
                    if (failure == null) failure = exception;
                    else failure.addSuppressed(exception);
                }
            }
            if (failure != null) throw failure;
        }
    }
}
