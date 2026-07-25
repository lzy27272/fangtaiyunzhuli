package cn.sifangguan.ota.worker.sprint2.contract;

import cn.sifangguan.ota.contracts.collection.StandardRecord;
import cn.sifangguan.ota.contracts.connector.ConnectorDescriptor;
import org.springframework.stereotype.Component;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

@Component
public final class ConnectorContractFingerprint {
    private static final Pattern RECORD_TYPE =
            Pattern.compile("[a-z][a-z0-9_.\\-]{2,95}");

    public String capabilityFingerprint(ConnectorDescriptor descriptor) {
        Objects.requireNonNull(descriptor, "descriptor");
        String capabilities = descriptor.capabilities().stream()
                .map(Enum::name)
                .sorted()
                .reduce((left, right) -> left + "," + right)
                .orElseThrow();
        String streams = descriptor.streams().stream()
                .map(Enum::name)
                .sorted()
                .reduce((left, right) -> left + "," + right)
                .orElseThrow();
        return sha256(String.join("\n",
                "sourceSystem=" + descriptor.sourceSystem().name(),
                "interactiveAuthorization=" + descriptor.interactiveAuthorization(),
                "capabilities=" + capabilities,
                "streams=" + streams));
    }

    public String schemaFingerprint(
            Map<String, Class<? extends StandardRecord>> schemas) {
        Objects.requireNonNull(schemas, "schemas");
        if (schemas.isEmpty()) {
            throw new IllegalArgumentException("schemas must not be empty");
        }
        String canonical = schemas.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> canonicalSchema(entry.getKey(), entry.getValue()))
                .reduce((left, right) -> left + "\n" + right)
                .orElseThrow();
        return sha256(canonical);
    }

    private static String canonicalSchema(
            String recordType,
            Class<? extends StandardRecord> schemaClass) {
        Objects.requireNonNull(recordType, "recordType");
        Objects.requireNonNull(schemaClass, "schemaClass");
        if (!RECORD_TYPE.matcher(recordType).matches()
                || !StandardRecord.class.isAssignableFrom(schemaClass)
                || !schemaClass.isRecord()) {
            throw new IllegalArgumentException("invalid standard-record schema");
        }
        String components = Arrays.stream(schemaClass.getRecordComponents())
                .map(component -> component.getName() + ":" + component.getGenericType().getTypeName())
                .sorted()
                .reduce((left, right) -> left + "," + right)
                .orElse("");
        return recordType + "|" + schemaClass.getName() + "|" + components;
    }

    private static String sha256(String canonical) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("JVM must provide SHA-256", impossible);
        }
    }
}
