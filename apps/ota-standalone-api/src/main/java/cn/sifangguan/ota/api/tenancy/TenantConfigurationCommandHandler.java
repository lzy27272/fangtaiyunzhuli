package cn.sifangguan.ota.api.tenancy;

public interface TenantConfigurationCommandHandler {
    CommandReceipt handle(TenantConfigurationCommand command);

    record CommandReceipt(String commandId, long resultingRowVersion, boolean replayed) {
        public CommandReceipt(String commandId, long resultingRowVersion) {
            this(commandId, resultingRowVersion, false);
        }
    }
}
