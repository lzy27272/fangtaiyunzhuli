package cn.sifangguan.hotelaios.notifications;

import jakarta.validation.constraints.PositiveOrZero;

public final class NotificationModels {
    private NotificationModels() {
    }

    public record MarkRead(@PositiveOrZero long expectedVersion) {
    }
}
