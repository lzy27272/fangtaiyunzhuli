package cn.sifangguan.hotelaios.integrations.wecom;

import java.util.Map;

record WeComInboundMessage(
        String messageId,
        String receiptType,
        String fromUserId,
        String eventKey,
        String payloadHash,
        Map<String, String> fields
) { }
