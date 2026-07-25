package cn.sifangguan.ota.worker.sprint2.config;

import java.util.Objects;
import java.util.Set;

public final class Sprint2OfflineRuntimeGate {
    public static final String REAL_PROFILE = "sprint2-real";
    public static final String SIMULATION_PROFILE = "sprint1-simulation";
    public static final String REAL_SIMULATION_PROFILE_CONFLICT =
            "SPRINT2_REAL_SIMULATION_PROFILE_CONFLICT";
    public static final String REAL_CONNECTORS_DISABLED =
            "SPRINT2_REAL_CONNECTORS_DISABLED";
    public static final String EXTERNAL_RUNTIME_NOT_IMPLEMENTED =
            "SPRINT2A_EXTERNAL_SECRETSTORE_EGRESS_NOT_IMPLEMENTED";

    public void assertStartupAllowed(Set<String> activeProfiles, boolean realEnabled) {
        Objects.requireNonNull(activeProfiles, "activeProfiles");
        if (!activeProfiles.contains(REAL_PROFILE)) {
            return;
        }
        if (activeProfiles.contains(SIMULATION_PROFILE)) {
            throw new IllegalStateException(REAL_SIMULATION_PROFILE_CONFLICT);
        }
        if (!realEnabled) {
            throw new IllegalStateException(REAL_CONNECTORS_DISABLED);
        }
        throw new IllegalStateException(EXTERNAL_RUNTIME_NOT_IMPLEMENTED);
    }
}
