package cn.sifangguan.hotelaios.integrations.wecom;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.List;

/** Implements the WeCom callback SHA-1 signature and AES-CBC protocol. */
@Component
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComCallbackCrypto {
    private static final int WECOM_BLOCK_SIZE = 32;
    private final WeComProperties properties;
    private final byte[] aesKey;
    private final SecureRandom random = new SecureRandom();

    public WeComCallbackCrypto(WeComProperties properties) {
        this.properties = properties;
        try {
            this.aesKey = Base64.getDecoder().decode(properties.callbackAesKey() + "=");
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("WECOM_CALLBACK_AES_KEY is not valid Base64", exception);
        }
        if (aesKey.length != 32) throw new IllegalStateException("WECOM_CALLBACK_AES_KEY must decode to 32 bytes");
    }

    public boolean signatureMatches(String signature, String timestamp, String nonce, String encrypted) {
        if (isBlank(signature) || isBlank(timestamp) || isBlank(nonce) || isBlank(encrypted)) return false;
        byte[] expected = signature(timestamp, nonce, encrypted).getBytes(StandardCharsets.US_ASCII);
        byte[] actual = signature.toLowerCase().getBytes(StandardCharsets.US_ASCII);
        return MessageDigest.isEqual(expected, actual);
    }

    public String signature(String timestamp, String nonce, String encrypted) {
        try {
            List<String> parts = new ArrayList<>(List.of(
                    properties.callbackToken(), timestamp, nonce, encrypted));
            Collections.sort(parts);
            MessageDigest digest = MessageDigest.getInstance("SHA-1");
            return HexFormat.of().formatHex(digest.digest(String.join("", parts).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-1 is unavailable", exception);
        }
    }

    public String decrypt(String encrypted) {
        try {
            byte[] ciphertext = Base64.getDecoder().decode(encrypted);
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new IvParameterSpec(aesKey, 0, 16));
            byte[] plain = unpad(cipher.doFinal(ciphertext));
            if (plain.length < 20) throw new IllegalArgumentException("WeCom callback plaintext is too short");
            int messageLength = ByteBuffer.wrap(plain, 16, 4).getInt();
            if (messageLength < 0 || 20L + messageLength > plain.length) {
                throw new IllegalArgumentException("WeCom callback message length is invalid");
            }
            String receiveId = new String(plain, 20 + messageLength, plain.length - 20 - messageLength,
                    StandardCharsets.UTF_8);
            if (!MessageDigest.isEqual(receiveId.getBytes(StandardCharsets.UTF_8),
                    properties.botReceiveId().getBytes(StandardCharsets.UTF_8))) {
                throw new IllegalArgumentException("WeCom bot callback receiveId does not match this deployment");
            }
            return new String(plain, 20, messageLength, StandardCharsets.UTF_8);
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("Unable to decrypt WeCom callback", exception);
        }
    }

    /** Package-visible to support protocol-vector and round-trip tests. */
    String encrypt(String message) {
        try {
            byte[] messageBytes = message.getBytes(StandardCharsets.UTF_8);
            byte[] receiveIdBytes = properties.botReceiveId().getBytes(StandardCharsets.UTF_8);
            ByteBuffer raw = ByteBuffer.allocate(20 + messageBytes.length + receiveIdBytes.length);
            byte[] prefix = new byte[16];
            random.nextBytes(prefix);
            raw.put(prefix).putInt(messageBytes.length).put(messageBytes).put(receiveIdBytes);
            byte[] padded = pad(raw.array());
            Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new IvParameterSpec(aesKey, 0, 16));
            return Base64.getEncoder().encodeToString(cipher.doFinal(padded));
        } catch (Exception exception) {
            throw new IllegalStateException("Unable to encrypt WeCom callback", exception);
        }
    }

    private static byte[] pad(byte[] input) {
        int padding = WECOM_BLOCK_SIZE - input.length % WECOM_BLOCK_SIZE;
        ByteBuffer result = ByteBuffer.allocate(input.length + padding);
        result.put(input);
        for (int index = 0; index < padding; index++) result.put((byte) padding);
        return result.array();
    }

    private static byte[] unpad(byte[] input) {
        if (input.length == 0) throw new IllegalArgumentException("WeCom callback padding is missing");
        int padding = Byte.toUnsignedInt(input[input.length - 1]);
        if (padding < 1 || padding > WECOM_BLOCK_SIZE || padding > input.length) {
            throw new IllegalArgumentException("WeCom callback padding is invalid");
        }
        for (int index = input.length - padding; index < input.length; index++) {
            if (Byte.toUnsignedInt(input[index]) != padding) {
                throw new IllegalArgumentException("WeCom callback padding is invalid");
            }
        }
        return java.util.Arrays.copyOf(input, input.length - padding);
    }

    private static boolean isBlank(String value) { return value == null || value.isBlank(); }
}
