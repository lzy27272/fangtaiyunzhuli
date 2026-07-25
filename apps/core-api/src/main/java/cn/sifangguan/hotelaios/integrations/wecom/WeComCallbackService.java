package cn.sifangguan.hotelaios.integrations.wecom;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Value;

import java.util.Set;
import java.util.UUID;

@Service
@ConditionalOnProperty(name = "app.wecom.enabled", havingValue = "true")
public class WeComCallbackService {
    private static final Set<String> TASK_CARD_EVENTS = Set.of("TEMPLATE_CARD_EVENT");

    private final WeComCallbackCrypto crypto;
    private final WeComJson json;
    private final WeComInboundReceiptService receipts;
    private final WeComCallbackProcessor processor;
    private final boolean taskActionsEnabled;

    public WeComCallbackService(
            WeComCallbackCrypto crypto,
            WeComJson json,
            WeComInboundReceiptService receipts,
            WeComCallbackProcessor processor,
            @Value("${app.wecom.bot.actions-enabled:false}") boolean taskActionsEnabled
    ) {
        this.crypto = crypto;
        this.json = json;
        this.receipts = receipts;
        this.processor = processor;
        this.taskActionsEnabled = taskActionsEnabled;
    }

    public String verify(String signature, String timestamp, String nonce, String echo) {
        if (!crypto.signatureMatches(signature, timestamp, nonce, echo)) {
            throw new IllegalArgumentException("WeCom callback signature is invalid");
        }
        return crypto.decrypt(echo);
    }

    public String handleBotJson(
            String signature,
            String timestamp,
            String nonce,
            String encryptedEnvelope
    ) {
        // Parsing and cryptographic verification happen before selecting or
        // applying the configured tenant to the database session.
        String encrypted = json.encryptedEnvelope(encryptedEnvelope);
        if (!crypto.signatureMatches(signature, timestamp, nonce, encrypted)) {
            throw new IllegalArgumentException("WeCom callback signature is invalid");
        }
        String plaintext = crypto.decrypt(encrypted);
        WeComInboundMessage message = json.parseCallback(plaintext);
        UUID correlationId = UUID.randomUUID();
        WeComInboundReceiptService.Reservation receipt = receipts.reserve(message, correlationId);
        if (receipt.duplicate()) return encryptedSuccess(timestamp, nonce);

        if (!taskActionsEnabled || !TASK_CARD_EVENTS.contains(message.receiptType()) || message.eventKey() == null) {
            receipts.complete(receipt.id(), "IGNORED");
            return encryptedSuccess(timestamp, nonce);
        }
        processor.processNew(receipt.id(), message.fromUserId(), message.eventKey(), correlationId);
        return encryptedSuccess(timestamp, nonce);
    }

    private String encryptedSuccess(String timestamp, String nonce) {
        String encrypted = crypto.encrypt("{}");
        return json.encryptedResponse(encrypted, crypto.signature(timestamp, nonce, encrypted), timestamp, nonce);
    }
}
