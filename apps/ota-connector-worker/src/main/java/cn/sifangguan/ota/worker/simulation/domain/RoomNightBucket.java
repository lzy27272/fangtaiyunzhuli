package cn.sifangguan.ota.worker.simulation.domain;

public record RoomNightBucket(
        int addedToday,
        int addedFuture,
        int removedToday,
        int removedFuture,
        int historicalAnomaly) {

    public RoomNightBucket {
        if (addedToday < 0 || addedFuture < 0 || removedToday < 0
                || removedFuture < 0 || historicalAnomaly < 0) {
            throw new IllegalArgumentException("room-night summary counts must not be negative");
        }
    }

    public int addedTotal() {
        return addedToday + addedFuture;
    }

    public int removedTotal() {
        return removedToday + removedFuture;
    }

    public int netTotal() {
        return addedTotal() - removedTotal();
    }
}
