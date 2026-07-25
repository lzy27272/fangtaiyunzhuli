package cn.sifangguan.ota.contracts.port;

import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AuditSinkPortTest {
    @Test
    void representsAccountServiceAndAnonymousActorsWithoutIdentityOverlap() {
        var accountId = UUID.randomUUID();
        var serviceId = UUID.randomUUID();

        var account = AuditSinkPort.AuditActor.account(accountId);
        var service = AuditSinkPort.AuditActor.service(serviceId);
        var anonymous = AuditSinkPort.AuditActor.anonymous();

        assertEquals(AuditSinkPort.ActorType.ACCOUNT, account.type());
        assertEquals(accountId, account.accountId().orElseThrow());
        assertEquals(serviceId, service.servicePrincipalId().orElseThrow());
        assertTrue(anonymous.accountId().isEmpty());
        assertTrue(anonymous.servicePrincipalId().isEmpty());
    }

    @Test
    void rejectsActorIdentifiersThatDoNotMatchTheirType() {
        var identifier = UUID.randomUUID();

        assertThrows(IllegalArgumentException.class, () -> new AuditSinkPort.AuditActor(
                AuditSinkPort.ActorType.ACCOUNT, Optional.empty(), Optional.empty()));
        assertThrows(IllegalArgumentException.class, () -> new AuditSinkPort.AuditActor(
                AuditSinkPort.ActorType.SERVICE,
                Optional.of(identifier),
                Optional.of(identifier)));
        assertThrows(IllegalArgumentException.class, () -> new AuditSinkPort.AuditActor(
                AuditSinkPort.ActorType.ANONYMOUS,
                Optional.of(identifier),
                Optional.empty()));
    }
}
