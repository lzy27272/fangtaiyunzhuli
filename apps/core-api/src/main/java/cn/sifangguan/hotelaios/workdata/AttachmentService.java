package cn.sifangguan.hotelaios.workdata;

import cn.sifangguan.hotelaios.shared.audit.AuditWriter;
import cn.sifangguan.hotelaios.shared.context.TenantPrincipal;
import cn.sifangguan.hotelaios.shared.db.TenantDatabaseContext;
import cn.sifangguan.hotelaios.shared.security.AccessPolicy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

@Service
public class AttachmentService {
    private static final Set<String> ALLOWED_IMAGE_TYPES = Set.of(MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE);
    private static final String PDF = MediaType.APPLICATION_PDF_VALUE;
    private static final String DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    private static final String XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    private static final long MAX_IMAGE_PIXELS = 40_000_000L;

    private final NamedParameterJdbcTemplate jdbc;
    private final TenantDatabaseContext databaseContext;
    private final AccessPolicy accessPolicy;
    private final AuditWriter auditWriter;
    private final AttachmentMalwareScanner malwareScanner;
    private final Path storageRoot;
    private final long maxSizeBytes;

    public AttachmentService(
            NamedParameterJdbcTemplate jdbc,
            TenantDatabaseContext databaseContext,
            AccessPolicy accessPolicy,
            AuditWriter auditWriter,
            AttachmentMalwareScanner malwareScanner,
            @Value("${app.attachments.root:var/attachments}") String storageRoot,
            @Value("${app.attachments.max-size-bytes:20971520}") long maxSizeBytes
    ) {
        this.jdbc = jdbc;
        this.databaseContext = databaseContext;
        this.accessPolicy = accessPolicy;
        this.auditWriter = auditWriter;
        this.malwareScanner = malwareScanner;
        this.storageRoot = Path.of(storageRoot).toAbsolutePath().normalize();
        this.maxSizeBytes = maxSizeBytes;
    }

    @Transactional
    public Map<String, Object> upload(UUID workRecordId, MultipartFile file) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-record.submit");
        RecordTarget record = recordTarget(principal, workRecordId);
        requireOwnerOrDelegatedSubmit(principal, record);
        if (Set.of("APPROVED", "REJECTED").contains(record.status())) {
            throw new IllegalArgumentException("已完成复核的工作记录不能追加附件");
        }
        UUID attachmentId = UUID.randomUUID();
        String originalName = normalizeOriginalName(file.getOriginalFilename());
        ValidatedUpload upload = validatedFile(file, originalName);
        byte[] content = upload.content();
        String safeName = safeName(originalName);
        String mediaType = upload.mediaType();
        String objectKey = principal.tenantId() + "/work-records/" + workRecordId + "/"
                + attachmentId + "-" + safeName;
        Path path = resolveObjectKey(objectKey);
        String sha256 = sha256(content);
        String scanStatus;
        try {
            Files.createDirectories(path.getParent());
            Files.write(path, content, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            scanStatus = malwareScanner.scan(path);
            jdbc.update("""
                    insert into attachment
                        (id, tenant_id, work_record_id, object_key, original_name, media_type,
                         size_bytes, sha256, scan_status)
                    values
                        (:id, :tenantId, :workRecordId, :objectKey, :originalName, :mediaType,
                         :sizeBytes, :sha256, :scanStatus)
                    """, base(principal)
                    .addValue("id", attachmentId)
                    .addValue("workRecordId", workRecordId)
                    .addValue("objectKey", objectKey)
                    .addValue("originalName", originalName)
                    .addValue("mediaType", mediaType)
                    .addValue("sizeBytes", content.length)
                    .addValue("sha256", sha256)
                    .addValue("scanStatus", scanStatus));
        } catch (RuntimeException exception) {
            deleteQuietly(path);
            throw exception;
        } catch (Exception exception) {
            deleteQuietly(path);
            throw new IllegalArgumentException("附件保存失败", exception);
        }
        auditWriter.record("WORK_RECORD_ATTACHMENT_UPLOADED", "ATTACHMENT", attachmentId,
                "{\"workRecordId\":\"" + workRecordId + "\",\"sha256\":\"" + sha256
                        + "\",\"scanStatus\":\"" + scanStatus + "\"}");
        return attachmentResponse(attachmentId, workRecordId, objectKey, originalName, mediaType,
                content.length, sha256, scanStatus);
    }

    public StoredObject storeObject(String objectKey, MultipartFile file) {
        String originalName = normalizeOriginalName(file == null ? null : file.getOriginalFilename());
        ValidatedUpload upload = validatedFile(file, originalName);
        Path path = resolveObjectKey(objectKey);
        String digest = sha256(upload.content());
        try {
            Files.createDirectories(path.getParent());
            Files.write(path, upload.content(), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            String scanStatus = malwareScanner.scan(path);
            return new StoredObject(objectKey, originalName, upload.mediaType(), upload.content().length, digest, scanStatus);
        } catch (RuntimeException exception) {
            deleteQuietly(path);
            throw exception;
        } catch (Exception exception) {
            deleteQuietly(path);
            throw new IllegalArgumentException("附件保存失败", exception);
        }
    }

    /**
     * Stores bytes produced by a trusted server-side renderer under the same guarded storage root as attachments.
     * The caller owns the object-key namespace; path traversal is rejected by {@link #resolveObjectKey(String)}.
     */
    public StoredObject storeGeneratedBytes(
            String objectKey,
            String originalName,
            String mediaType,
            byte[] content
    ) {
        if (objectKey == null || objectKey.isBlank()) {
            throw new IllegalArgumentException("服务端生成文件的对象键不能为空");
        }
        if (content == null || content.length == 0) {
            throw new IllegalArgumentException("服务端生成文件不能为空");
        }
        if (content.length > maxSizeBytes) {
            throw new IllegalArgumentException("服务端生成文件超过允许大小");
        }
        String normalizedName = normalizeOriginalName(originalName);
        String normalizedType = normalizedMediaType(mediaType).split(";", 2)[0].trim();
        if (!Set.of("text/csv", PDF, XLSX).contains(normalizedType)) {
            throw new IllegalArgumentException("不支持的服务端生成文件类型");
        }

        Path path = resolveObjectKey(objectKey);
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp-" + UUID.randomUUID());
        String digest = sha256(content);
        try {
            Files.createDirectories(path.getParent());
            Files.write(temporary, content, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            try {
                Files.move(temporary, path,
                        StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException exception) {
                Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING);
            }
            return new StoredObject(
                    objectKey, normalizedName, normalizedType, content.length, digest, "SERVER_GENERATED");
        } catch (Exception exception) {
            deleteQuietly(temporary);
            throw new IllegalArgumentException("服务端生成文件保存失败", exception);
        }
    }

    /** Opens only a server-generated object after its owning service has performed authorization checks. */
    public Download openGeneratedObject(
            String objectKey,
            String originalName,
            String mediaType,
            long sizeBytes,
            String expectedSha256
    ) {
        Path path = resolveObjectKey(objectKey);
        if (!Files.isRegularFile(path)) {
            throw new IllegalArgumentException("服务端生成文件不存在或尚未完成生成");
        }
        try {
            if (Files.size(path) != sizeBytes) {
                throw new IllegalArgumentException("服务端生成文件大小校验失败");
            }
            if (expectedSha256 == null || !expectedSha256.matches("[0-9a-f]{64}")
                    || !expectedSha256.equals(sha256(path))) {
                throw new IllegalArgumentException("服务端生成文件摘要校验失败");
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法校验服务端生成文件", exception);
        }
        return new Download(new FileSystemResource(path), normalizeOriginalName(originalName),
                normalizedMediaType(mediaType), sizeBytes);
    }

    public Download openStoredObject(
            String objectKey,
            String originalName,
            String mediaType,
            long sizeBytes,
            String scanStatus
    ) {
        if (!malwareScanner.canDownload(scanStatus)) {
            throw new IllegalArgumentException("附件尚未通过安全扫描，禁止下载");
        }
        Path path = resolveObjectKey(objectKey);
        if (!Files.isRegularFile(path)) {
            throw new IllegalArgumentException("附件文件不存在或尚未完成上传");
        }
        return new Download(new FileSystemResource(path), originalName, mediaType, sizeBytes);
    }

    public void removeStoredObject(String objectKey) {
        try {
            Files.deleteIfExists(resolveObjectKey(objectKey));
        } catch (Exception exception) {
            throw new IllegalArgumentException("附件文件删除失败", exception);
        }
    }

    /**
     * Deletes generated export attempts only inside the server-owned tenant/job UUID namespace.
     * When a winner key is supplied, that file and its ancestor directories are retained.
     */
    public void cleanupGeneratedExportJob(UUID tenantId, UUID jobId, String winnerObjectKey) {
        String jobPrefix = tenantId + "/operation-exports/" + jobId + "/";
        Path jobDirectory = resolveObjectKey(jobPrefix);
        Path winner = null;
        if (winnerObjectKey != null) {
            if (!winnerObjectKey.startsWith(jobPrefix)
                    || !winnerObjectKey.substring(jobPrefix.length())
                    .matches("attempt-[0-9]+/[\\p{L}\\p{N}._-]{1,160}")) {
                throw new IllegalArgumentException("导出对象键不属于指定租户和作业命名空间");
            }
            winner = resolveObjectKey(winnerObjectKey);
        }
        if (!Files.exists(jobDirectory)) return;
        Path retained = winner;
        try (var paths = Files.walk(jobDirectory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                if (retained != null && (path.equals(retained) || retained.startsWith(path))) return;
                try {
                    Files.deleteIfExists(path);
                } catch (Exception exception) {
                    throw new GeneratedObjectCleanupException(exception);
                }
            });
        } catch (GeneratedObjectCleanupException exception) {
            throw new IllegalArgumentException("导出作业目录清理失败", exception.getCause());
        } catch (Exception exception) {
            throw new IllegalArgumentException("导出作业目录清理失败", exception);
        }
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> list(UUID workRecordId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-record.read");
        RecordTarget record = recordTarget(principal, workRecordId);
        accessPolicy.requireOrgScope(record.targetOrgUnitId());
        return jdbc.queryForList("""
                select id, work_record_id, object_key, original_name, media_type, size_bytes,
                       sha256, scan_status, created_at
                from attachment
                where tenant_id = :tenantId and work_record_id = :workRecordId
                order by created_at, id
                """, base(principal).addValue("workRecordId", workRecordId));
    }

    @Transactional(readOnly = true)
    public Download download(UUID attachmentId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-record.read");
        Map<String, Object> attachment = jdbc.queryForMap("""
                select a.object_key, a.original_name, a.media_type, a.size_bytes, a.scan_status,
                       w.target_org_unit_id
                from attachment a
                join work_record w on w.tenant_id = a.tenant_id and w.id = a.work_record_id
                where a.tenant_id = :tenantId and a.id = :attachmentId
                """, base(principal).addValue("attachmentId", attachmentId));
        accessPolicy.requireOrgScope((UUID) attachment.get("target_org_unit_id"));
        if (!malwareScanner.canDownload(String.valueOf(attachment.get("scan_status")))) {
            throw new IllegalArgumentException("附件尚未通过安全扫描，禁止下载");
        }
        Path path = resolveObjectKey(String.valueOf(attachment.get("object_key")));
        if (!Files.isRegularFile(path)) {
            throw new IllegalArgumentException("附件文件不存在或尚未完成上传");
        }
        Resource resource = new FileSystemResource(path);
        return new Download(resource, String.valueOf(attachment.get("original_name")),
                String.valueOf(attachment.get("media_type")), ((Number) attachment.get("size_bytes")).longValue());
    }

    @Transactional
    public void delete(UUID workRecordId, UUID attachmentId) {
        TenantPrincipal principal = prepare();
        accessPolicy.requirePermission("work-record.submit");
        RecordTarget record = recordTarget(principal, workRecordId);
        requireOwnerOrDelegatedSubmit(principal, record);
        if (Set.of("APPROVED", "REJECTED").contains(record.status())) {
            throw new IllegalArgumentException("已完成复核的工作记录不能删除附件");
        }
        String objectKey = jdbc.queryForObject("""
                select object_key from attachment
                where tenant_id = :tenantId and id = :attachmentId and work_record_id = :workRecordId
                """, base(principal).addValue("attachmentId", attachmentId)
                .addValue("workRecordId", workRecordId), String.class);
        int deleted = jdbc.update("""
                delete from attachment
                where tenant_id = :tenantId and id = :attachmentId and work_record_id = :workRecordId
                """, base(principal).addValue("attachmentId", attachmentId)
                .addValue("workRecordId", workRecordId));
        if (deleted != 1) {
            throw new IllegalArgumentException("附件不存在或不属于该工作记录");
        }
        try {
            Files.deleteIfExists(resolveObjectKey(objectKey));
        } catch (Exception exception) {
            throw new IllegalArgumentException("附件文件删除失败", exception);
        }
        auditWriter.record("WORK_RECORD_ATTACHMENT_DELETED", "ATTACHMENT", attachmentId,
                "{\"workRecordId\":\"" + workRecordId + "\"}");
    }

    private ValidatedUpload validatedFile(MultipartFile file, String originalName) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("请选择需要上传的附件");
        }
        if (file.getSize() > maxSizeBytes) {
            throw new IllegalArgumentException("附件大小不能超过" + maxSizeBytes + "字节");
        }
        try {
            byte[] content = file.getBytes();
            String extension = extension(originalName);
            String mediaType = resolvedMediaType(file.getContentType(), extension, content);
            if (!ALLOWED_IMAGE_TYPES.contains(mediaType)) {
                return new ValidatedUpload(content, mediaType);
            }
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(content));
            if (image == null) {
                throw new IllegalArgumentException("文件内容不是有效图片");
            }
            long pixels = Math.multiplyExact((long) image.getWidth(), (long) image.getHeight());
            if (image.getWidth() <= 0 || image.getHeight() <= 0 || pixels > MAX_IMAGE_PIXELS) {
                throw new IllegalArgumentException("图片像素尺寸过大，无法作为工作证据上传");
            }
            String format = MediaType.IMAGE_PNG_VALUE.equals(mediaType) ? "png" : "jpeg";
            ByteArrayOutputStream sanitized = new ByteArrayOutputStream(content.length);
            if (!ImageIO.write(image, format, sanitized)) {
                throw new IllegalArgumentException("图片格式无法安全重新编码");
            }
            byte[] sanitizedContent = sanitized.toByteArray();
            if (sanitizedContent.length > maxSizeBytes) {
                throw new IllegalArgumentException("重新编码后的图片超过允许大小");
            }
            return new ValidatedUpload(sanitizedContent, mediaType);
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("无法读取附件内容", exception);
        }
    }

    private String resolvedMediaType(String suppliedType, String extension, byte[] content) {
        String normalized = normalizedMediaType(suppliedType);
        if (("jpg".equals(extension) || "jpeg".equals(extension)) && startsWith(content, 0xff, 0xd8, 0xff)) {
            return MediaType.IMAGE_JPEG_VALUE;
        }
        if ("png".equals(extension) && startsWith(content, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
            return MediaType.IMAGE_PNG_VALUE;
        }
        if ("pdf".equals(extension) && startsWith(content, 0x25, 0x50, 0x44, 0x46, 0x2d)) {
            return PDF;
        }
        if ("docx".equals(extension) && isOfficeZip(content, "word/")) {
            return DOCX;
        }
        if ("xlsx".equals(extension) && isOfficeZip(content, "xl/")) {
            return XLSX;
        }
        throw new IllegalArgumentException("仅支持JPG、PNG、PDF、DOCX和XLSX附件，且文件内容必须与扩展名一致（收到 " + normalized + "）");
    }

    private boolean isOfficeZip(byte[] content, String requiredPrefix) {
        if (!startsWith(content, 0x50, 0x4b)) return false;
        boolean contentTypes = false;
        boolean requiredDirectory = false;
        int entries = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(content))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                entries += 1;
                if (entries > 10_000) throw new IllegalArgumentException("Office文档条目数量异常");
                String name = entry.getName().replace('\\', '/');
                if ("[Content_Types].xml".equals(name)) contentTypes = true;
                if (name.startsWith(requiredPrefix)) requiredDirectory = true;
                if (contentTypes && requiredDirectory) return true;
            }
            return false;
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            return false;
        }
    }

    private boolean startsWith(byte[] content, int... expected) {
        if (content.length < expected.length) return false;
        for (int index = 0; index < expected.length; index++) {
            if ((content[index] & 0xff) != expected[index]) return false;
        }
        return true;
    }

    private String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot < 0 ? "" : name.substring(dot + 1).toLowerCase(Locale.ROOT);
    }

    private RecordTarget recordTarget(TenantPrincipal principal, UUID workRecordId) {
        return jdbc.queryForObject("""
                select status, target_org_unit_id, position_assignment_id
                from work_record where tenant_id = :tenantId and id = :workRecordId
                """, base(principal).addValue("workRecordId", workRecordId),
                (rs, rowNum) -> new RecordTarget(rs.getString("status"),
                        rs.getObject("target_org_unit_id", UUID.class),
                        rs.getObject("position_assignment_id", UUID.class)));
    }

    private void requireOwnerOrDelegatedSubmit(TenantPrincipal principal, RecordTarget record) {
        accessPolicy.requireOrgScope(record.targetOrgUnitId());
        if (!principal.assignmentIds().contains(record.assignmentId())) {
            accessPolicy.requirePermission("work-record.submit-for-other");
        }
    }

    private TenantPrincipal prepare() {
        TenantPrincipal principal = accessPolicy.principal();
        databaseContext.apply(principal.tenantId());
        return principal;
    }

    private MapSqlParameterSource base(TenantPrincipal principal) {
        return new MapSqlParameterSource("tenantId", principal.tenantId());
    }

    private Path resolveObjectKey(String objectKey) {
        Path resolved = storageRoot.resolve(objectKey.replace('/', java.io.File.separatorChar)).normalize();
        if (!resolved.startsWith(storageRoot)) {
            throw new IllegalArgumentException("附件对象键越界");
        }
        return resolved;
    }

    private static String normalizeOriginalName(String originalName) {
        if (originalName == null || originalName.isBlank()) {
            return "image";
        }
        String name = Path.of(originalName).getFileName().toString().trim();
        return name.length() > 240 ? name.substring(name.length() - 240) : name;
    }

    private static String safeName(String originalName) {
        String result = originalName.replaceAll("[^a-zA-Z0-9._-]", "_");
        return result.isBlank() ? "image" : result;
    }

    private static String normalizedMediaType(String mediaType) {
        return mediaType == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE : mediaType.trim().toLowerCase(Locale.ROOT);
    }

    private static String sha256(byte[] content) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (Exception exception) {
            throw new IllegalStateException("无法计算附件摘要", exception);
        }
    }

    private static String sha256(Path path) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (var input = Files.newInputStream(path, StandardOpenOption.READ)) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) >= 0) {
                if (read > 0) digest.update(buffer, 0, read);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }

    private static Map<String, Object> attachmentResponse(
            UUID id, UUID recordId, String objectKey, String originalName, String mediaType,
            long sizeBytes, String sha256, String scanStatus
    ) {
        return Map.of(
                "id", id,
                "workRecordId", recordId,
                "objectKey", objectKey,
                "originalName", originalName,
                "mediaType", mediaType,
                "sizeBytes", sizeBytes,
                "sha256", sha256,
                "scanStatus", scanStatus,
                "contentUrl", "/api/v1/work-data/attachments/" + id + "/content"
        );
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (Exception ignored) {
            // The database operation still fails; an orphan cleanup job may remove the file later.
        }
    }

    private record RecordTarget(String status, UUID targetOrgUnitId, UUID assignmentId) {
    }

    public record Download(Resource resource, String originalName, String mediaType, long sizeBytes) {
    }

    public record StoredObject(
            String objectKey,
            String originalName,
            String mediaType,
            long sizeBytes,
            String sha256,
            String scanStatus
    ) {
    }

    private record ValidatedUpload(byte[] content, String mediaType) {
    }

    private static final class GeneratedObjectCleanupException extends RuntimeException {
        GeneratedObjectCleanupException(Throwable cause) {
            super(cause);
        }
    }
}
