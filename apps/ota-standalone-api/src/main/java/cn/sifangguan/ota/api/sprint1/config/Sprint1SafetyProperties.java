package cn.sifangguan.ota.api.sprint1.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "ota.sprint1")
public class Sprint1SafetyProperties {
    private boolean simulationEnabled;
    private boolean outboundHttpEnabled;

    public boolean isSimulationEnabled() {
        return simulationEnabled;
    }

    public void setSimulationEnabled(boolean simulationEnabled) {
        this.simulationEnabled = simulationEnabled;
    }

    public boolean isOutboundHttpEnabled() {
        return outboundHttpEnabled;
    }

    public void setOutboundHttpEnabled(boolean outboundHttpEnabled) {
        this.outboundHttpEnabled = outboundHttpEnabled;
    }
}
