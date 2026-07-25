package cn.sifangguan.ota.worker.browser;

import java.util.Objects;

/**
 * Produces the only command type accepted by an isolated browser client.
 *
 * <p>The guard compares every operation identity field against an independently
 * supplied trusted manifest before an implementation can call a helper.</p>
 */
public final class BrowserOperationAdmissionGuard {
    private final BrowserOperationAdmissionManifest manifest;

    public BrowserOperationAdmissionGuard(
            BrowserOperationAdmissionManifest manifest) {
        this.manifest = Objects.requireNonNull(manifest, "manifest");
    }

    public AdmittedCommand admit(BrowserSessionCollectionCommand command) {
        Objects.requireNonNull(command, "command");
        if (!manifest.admits(command)) {
            throw new BrowserOperationAdmissionException();
        }
        return new AdmittedCommand(command);
    }

    /**
     * Capability token with a private constructor. Browser clients therefore
     * cannot receive an unchecked raw command through their public port.
     */
    public static final class AdmittedCommand {
        private final BrowserSessionCollectionCommand command;

        private AdmittedCommand(BrowserSessionCollectionCommand command) {
            this.command = command;
        }

        public BrowserSessionCollectionCommand command() {
            return command;
        }

        @Override
        public String toString() {
            return "AdmittedCommand[scope=<redacted>, operation="
                    + command.approvedOperationCode() + "]";
        }
    }
}
