package cn.sifangguan.ota.worker.simulation.persistence;

import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.UUID;

public final class JdbcDynamicSchedulePort implements DynamicSchedulePort {
    private final JdbcTemplate jdbc;

    public JdbcDynamicSchedulePort(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
    }

    @Override
    public int dispatchDue(
            UUID schedulerServicePrincipalId,
            Instant now,
            int batchLimit) {
        Objects.requireNonNull(schedulerServicePrincipalId, "schedulerServicePrincipalId");
        Objects.requireNonNull(now, "now");
        if (batchLimit < 1 || batchLimit > 500) {
            throw new IllegalArgumentException("batchLimit must be within [1,500]");
        }
        Integer dispatched = jdbc.queryForObject("""
                SELECT count(*)
                  FROM control.dispatch_due_ota_jobs(?, ?, ?)
                """,
                Integer.class,
                schedulerServicePrincipalId,
                OffsetDateTime.ofInstant(now, ZoneOffset.UTC),
                batchLimit);
        return Objects.requireNonNullElse(dispatched, 0);
    }
}
