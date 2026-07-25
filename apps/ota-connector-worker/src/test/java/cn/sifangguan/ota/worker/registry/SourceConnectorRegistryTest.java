package cn.sifangguan.ota.worker.registry;

import cn.sifangguan.ota.worker.fixture.CollectionFixtures;
import cn.sifangguan.ota.worker.fixture.TestSourceConnector;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class SourceConnectorRegistryTest {
    @Test
    void registersDescriptorsInStableCodeOrder() {
        var registry = new SourceConnectorRegistry(List.of(
                new TestSourceConnector("pms.zeta", ignored -> CollectionFixtures.success()),
                new TestSourceConnector("pms.alpha", ignored -> CollectionFixtures.success())));

        assertEquals(
                List.of("pms.alpha", "pms.zeta"),
                registry.descriptors().stream().map(descriptor -> descriptor.connectorCode()).toList());
    }

    @Test
    void refusesDuplicateConnectorCodes() {
        var first = new TestSourceConnector("pms.same", ignored -> CollectionFixtures.success());
        var second = new TestSourceConnector("pms.same", ignored -> CollectionFixtures.success());

        assertThrows(IllegalStateException.class, () -> new SourceConnectorRegistry(List.of(first, second)));
    }
}
