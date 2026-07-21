package cn.sifangguan.hotelaios.shared.events;

import java.util.Locale;

/** Canonical event type representation shared by producers, projectors and rule matching. */
public final class EventTypeNames {
    private EventTypeNames() {
    }

    public static String normalize(String eventType) {
        if (eventType == null || eventType.isBlank()) {
            throw new IllegalArgumentException("eventType must not be blank");
        }
        return eventType.trim().toUpperCase(Locale.ROOT);
    }
}
