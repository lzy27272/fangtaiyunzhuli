package cn.sifangguan.ota.worker.simulation.persistence;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SimulationDatabaseSafetyVerifierTest {
    @Test
    void startupGateRequiresBoundPrincipalAndExactFunctionSecurity() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID expectedPrincipalId = UUID.randomUUID();
        when(jdbc.queryForObject(anyString(), eq(Boolean.class)))
                .thenReturn(true, true, false, true, true);
        when(jdbc.queryForObject(
                anyString(),
                eq(Boolean.class),
                eq(expectedPrincipalId.toString())))
                .thenReturn(true);

        new SimulationDatabaseSafetyVerifier(
                jdbc,
                expectedPrincipalId).verify();

        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, org.mockito.Mockito.times(5))
                .queryForObject(sql.capture(), eq(Boolean.class));
        List<String> checks = sql.getAllValues();
        assertTrue(checks.stream().anyMatch(value -> value.contains(
                "control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)")));
        assertTrue(checks.stream().anyMatch(value -> value.contains(
                "control.dispatch_due_ota_jobs(uuid,timestamptz,integer)")));
        assertTrue(checks.stream().anyMatch(value -> value.contains(
                "control.current_bound_service_principal_id()")));
        assertTrue(checks.stream().anyMatch(value -> value.contains(
                "control.assert_session_service_principal")));
        assertTrue(checks.stream().anyMatch(value ->
                value.contains("role.rolcanlogin")
                        && value.contains("NOT role.rolinherit")
                        && value.contains("NOT role.rolreplication")
                        && value.contains("current_user = session_user")));
        assertTrue(checks.stream().anyMatch(value ->
                value.contains("pg_catalog.pg_database")
                        && value.contains("'flyway', 'control', 'ota'")));
        verify(jdbc).queryForObject(
                anyString(),
                eq(Boolean.class),
                eq(expectedPrincipalId.toString()));
    }

    @Test
    void startupGateRejectsAConfiguredPrincipalThatDoesNotMatchSessionBinding() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID expectedPrincipalId = UUID.randomUUID();
        when(jdbc.queryForObject(anyString(), eq(Boolean.class)))
                .thenReturn(true, true);
        when(jdbc.queryForObject(
                anyString(),
                eq(Boolean.class),
                eq(expectedPrincipalId.toString())))
                .thenReturn(false);

        IllegalStateException failure = assertThrows(
                IllegalStateException.class,
                () -> new SimulationDatabaseSafetyVerifier(
                        jdbc,
                        expectedPrincipalId).verify());

        assertTrue(failure.getMessage().contains(
                "SERVICE_PRINCIPAL_BINDING_MISMATCH"));
    }
}
