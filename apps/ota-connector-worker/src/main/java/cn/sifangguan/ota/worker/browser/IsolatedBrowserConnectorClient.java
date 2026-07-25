package cn.sifangguan.ota.worker.browser;

import cn.sifangguan.ota.contracts.collection.CollectionResult;

/**
 * Worker-side port for a separately admitted browser-session helper.
 *
 * <p>The implementation belongs in an isolated process. This port deliberately has no
 * cookie, password, token, browser-storage or HTTP types.
 */
public interface IsolatedBrowserConnectorClient {
    CollectionResult collect(
            BrowserOperationAdmissionGuard.AdmittedCommand admittedCommand);
}
