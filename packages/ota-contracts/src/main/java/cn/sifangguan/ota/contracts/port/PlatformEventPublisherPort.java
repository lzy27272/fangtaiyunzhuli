package cn.sifangguan.ota.contracts.port;

import cn.sifangguan.ota.contracts.event.DomainEventEnvelope;
import cn.sifangguan.ota.contracts.event.DomainEventPayload;

public interface PlatformEventPublisherPort {
    void publish(DomainEventEnvelope<? extends DomainEventPayload> event);
}
