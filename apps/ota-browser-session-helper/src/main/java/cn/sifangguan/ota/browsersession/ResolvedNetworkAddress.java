package cn.sifangguan.ota.browsersession;

import java.util.Objects;

public record ResolvedNetworkAddress(String literal) {
    public ResolvedNetworkAddress {
        Objects.requireNonNull(literal, "literal");
        IpAddressClassifier.isPublicRoutable(literal);
    }

    public boolean isPublicRoutable() {
        return IpAddressClassifier.isPublicRoutable(literal);
    }
}
