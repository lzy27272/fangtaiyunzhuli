package cn.sifangguan.ota.worker.sprint2.validation;

import java.util.Objects;

public final class CollectionResultValidationException extends RuntimeException {
    private final CollectionResultRejectionReason reason;

    public CollectionResultValidationException(CollectionResultRejectionReason reason) {
        super(Objects.requireNonNull(reason, "reason").name());
        this.reason = reason;
    }

    public CollectionResultRejectionReason reason() {
        return reason;
    }

    public String reasonCode() {
        return reason.name();
    }
}
