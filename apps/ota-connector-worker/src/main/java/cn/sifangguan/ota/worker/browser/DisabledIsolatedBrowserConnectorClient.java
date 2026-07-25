package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.collection.CollectionResult;

import java.util.Objects;

/**
 * Fail-closed placeholder used while the external helper, admission and egress remain blocked.
 */
public final class DisabledIsolatedBrowserConnectorClient
        implements IsolatedBrowserConnectorClient {

    @Override
    public CollectionResult collect(
            BrowserOperationAdmissionGuard.AdmittedCommand admittedCommand) {
        Objects.requireNonNull(admittedCommand, "admittedCommand");
        throw new BrowserSessionHelperUnavailableException();
    }
}
