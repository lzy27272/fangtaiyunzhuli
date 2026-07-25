package cn.sifangguan.ota.contracts.connector;

import java.util.Objects;
import java.util.Set;

public record ConnectorCapabilityRequirement(Set<ConnectorCapability> required) {
    public ConnectorCapabilityRequirement {
        required = Set.copyOf(Objects.requireNonNull(required, "required"));
    }

    public boolean isSatisfiedBy(ConnectorDescriptor descriptor) {
        Objects.requireNonNull(descriptor, "descriptor");
        return descriptor.capabilities().containsAll(required);
    }
}
