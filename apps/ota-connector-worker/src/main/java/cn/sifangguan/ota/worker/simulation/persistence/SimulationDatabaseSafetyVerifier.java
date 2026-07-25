package cn.sifangguan.ota.worker.simulation.persistence;

import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Objects;
import java.util.UUID;

public final class SimulationDatabaseSafetyVerifier {
    private final JdbcTemplate jdbc;
    private final UUID expectedServicePrincipalId;

    public SimulationDatabaseSafetyVerifier(
            JdbcTemplate jdbc,
            UUID expectedServicePrincipalId) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc");
        this.expectedServicePrincipalId = Objects.requireNonNull(
                expectedServicePrincipalId,
                "expectedServicePrincipalId");
    }

    public void verify() {
        var safeRole = jdbc.queryForObject("""
                SELECT current_user = session_user
                   AND role.rolcanlogin
                   AND NOT role.rolsuper
                   AND NOT role.rolbypassrls
                   AND NOT role.rolinherit
                   AND NOT role.rolcreaterole
                   AND NOT role.rolcreatedb
                   AND NOT role.rolreplication
                   AND NOT EXISTS (
                       SELECT 1
                         FROM pg_catalog.pg_auth_members membership
                        WHERE membership.member = role.oid
                           OR membership.roleid = role.oid
                   )
                  FROM pg_catalog.pg_roles role
                 WHERE role.rolname = session_user
                """, Boolean.class);
        if (!Boolean.TRUE.equals(safeRole)) {
            throw new IllegalStateException("SIMULATION_DATABASE_ROLE_UNSAFE");
        }
        var requiredObjects = jdbc.queryForObject("""
                SELECT to_regclass('ota.simulation_run') IS NOT NULL
                   AND to_regclass('ota.connector_collection_run') IS NOT NULL
                   AND to_regclass('ota.daily_operation_snapshot') IS NOT NULL
                   AND to_regclass('ota.ota_hourly_brief') IS NOT NULL
                   AND to_regclass('ota.notification_delivery') IS NOT NULL
                   AND to_regprocedure(
                       'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)'
                   ) IS NOT NULL
                   AND to_regprocedure(
                       'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)'
                   ) IS NOT NULL
                   AND to_regprocedure(
                       'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'
                   ) IS NOT NULL
                   AND to_regprocedure(
                       'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'
                   ) IS NOT NULL
                   AND to_regclass(
                       'control.service_principal_database_role_binding'
                   ) IS NOT NULL
                   AND to_regprocedure(
                       'control.current_bound_service_principal_id()'
                   ) IS NOT NULL
                   AND to_regprocedure(
                       'control.assert_session_service_principal(uuid,text[])'
                   ) IS NOT NULL
                """, Boolean.class);
        if (!Boolean.TRUE.equals(requiredObjects)) {
            throw new IllegalStateException("SPRINT2A_DATABASE_MIGRATION_REQUIRED");
        }

        var expectedBinding = jdbc.queryForObject("""
                SELECT control.current_bound_service_principal_id() = ?::UUID
                """, Boolean.class, expectedServicePrincipalId.toString());
        if (!Boolean.TRUE.equals(expectedBinding)) {
            throw new IllegalStateException(
                    "SIMULATION_DATABASE_SERVICE_PRINCIPAL_BINDING_MISMATCH");
        }

        var ownsDeploymentObject = jdbc.queryForObject("""
                SELECT EXISTS (
                    SELECT 1
                      FROM pg_catalog.pg_database db
                     WHERE db.datname = current_database()
                       AND pg_catalog.pg_get_userbyid(db.datdba)
                           = session_user
                    UNION ALL
                    SELECT 1
                      FROM pg_catalog.pg_namespace namespace
                     WHERE namespace.nspname IN ('flyway', 'control', 'ota')
                       AND pg_catalog.pg_get_userbyid(namespace.nspowner) = session_user
                    UNION ALL
                    SELECT 1
                      FROM pg_catalog.pg_class relation
                      JOIN pg_catalog.pg_namespace namespace
                        ON namespace.oid = relation.relnamespace
                     WHERE namespace.nspname IN ('flyway', 'control', 'ota')
                       AND pg_catalog.pg_get_userbyid(relation.relowner) = session_user
                    UNION ALL
                    SELECT 1
                      FROM pg_catalog.pg_proc function
                      JOIN pg_catalog.pg_namespace namespace
                        ON namespace.oid = function.pronamespace
                     WHERE namespace.nspname IN ('flyway', 'control', 'ota')
                       AND pg_catalog.pg_get_userbyid(function.proowner) = session_user
                )
                """, Boolean.class);
        if (Boolean.TRUE.equals(ownsDeploymentObject)) {
            throw new IllegalStateException(
                    "SIMULATION_RUNTIME_MUST_NOT_OWN_DEPLOYMENT_OBJECTS");
        }

        var exposedFunctionGate = jdbc.queryForObject("""
                WITH expected(signature, expected_volatility) AS (
                    VALUES
                        ('control.current_tenant_id()', 's'),
                        ('control.current_bound_service_principal_id()', 'v'),
                        ('control.dispatch_due_ota_jobs(uuid,timestamptz,integer)', 'v'),
                        ('control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)', 'v'),
                        ('control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)', 'v'),
                        ('control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)', 'v'),
                        ('control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)', 'v')
                ),
                inspected AS (
                    SELECT expected.signature,
                           expected.expected_volatility,
                           function.oid,
                           function.proowner,
                           function.prosecdef,
                           function.provolatile,
                           function.proconfig,
                           function.proacl,
                           pg_catalog.pg_get_functiondef(function.oid) AS definition
                      FROM expected
                      JOIN pg_catalog.pg_proc function
                        ON function.oid =
                           pg_catalog.to_regprocedure(expected.signature)
                )
                SELECT count(*) = 7
                   AND bool_and(inspected.prosecdef)
                   AND bool_and(
                       inspected.provolatile::TEXT =
                       inspected.expected_volatility
                   )
                   AND bool_and(
                       inspected.proconfig =
                       ARRAY['search_path=pg_catalog']::TEXT[]
                   )
                   AND bool_and(
                       pg_catalog.pg_get_userbyid(inspected.proowner)
                       <> session_user
                   )
                   AND bool_and(
                       pg_catalog.has_function_privilege(
                           inspected.oid,
                           'EXECUTE'
                       )
                   )
                   AND bool_and(
                       NOT EXISTS (
                           SELECT 1
                             FROM pg_catalog.aclexplode(
                                 COALESCE(
                                     inspected.proacl,
                                     pg_catalog.acldefault(
                                         'f',
                                         inspected.proowner
                                     )
                                 )
                             ) acl
                            WHERE acl.privilege_type = 'EXECUTE'
                              AND acl.grantee = 0
                       )
                   )
                   AND bool_and(
                        (
                            inspected.signature =
                            'control.current_tenant_id()'
                            AND inspected.definition LIKE '%session_user%'
                            AND inspected.definition LIKE '%database_role_oid%'
                            AND inspected.definition LIKE '%database_role_name%'
                            AND inspected.definition LIKE '%pg_auth_members%'
                            AND inspected.definition LIKE '%transaction_isolation%'
                            AND inspected.definition LIKE '%statement_timestamp()%'
                            AND inspected.definition NOT LIKE '%FOR SHARE%'
                        )
                        OR
                        (
                            inspected.signature =
                            'control.current_bound_service_principal_id()'
                            AND inspected.definition LIKE '%session_user%'
                            AND inspected.definition LIKE '%database_role_oid%'
                            AND inspected.definition LIKE '%database_role_name%'
                            AND inspected.definition LIKE '%pg_auth_members%'
                            AND inspected.definition LIKE '%transaction_isolation%'
                            AND inspected.definition LIKE '%FOR SHARE%'
                       )
                       OR
                        (
                            inspected.signature NOT IN (
                                'control.current_tenant_id()',
                                'control.current_bound_service_principal_id()'
                            )
                            AND (
                                (
                                    inspected.signature IN (
                                        'control.dispatch_due_ota_jobs(uuid,timestamptz,integer)',
                                        'control.claim_ota_job(uuid,uuid,uuid,timestamptz,timestamptz,text)',
                                        'control.renew_ota_job_lease(uuid,uuid,uuid,timestamptz,timestamptz)'
                                    )
                                    AND inspected.definition LIKE
                                        '%control.assert_session_active_service_principal%'
                                    AND inspected.definition LIKE
                                        '%clock_timestamp()%'
                                )
                                OR
                                (
                                    inspected.signature =
                                        'control.complete_ota_job(uuid,uuid,uuid,timestamptz,text,text)'
                                    AND inspected.definition LIKE
                                        '%control.assert_session_service_principal%'
                                    AND inspected.definition LIKE
                                        '%clock_timestamp()%'
                                    AND inspected.definition LIKE
                                        '%lease_acquired_at <= live_draining_at%'
                                )
                                OR
                                (
                                    inspected.signature =
                                    'control.read_effective_connector_contract_baseline(uuid,uuid,uuid,uuid,text)'
                                    AND inspected.definition LIKE
                                        '%control.current_bound_service_principal_id%'
                                )
                            )
                        )
                   )
                  FROM inspected
                """, Boolean.class);
        if (!Boolean.TRUE.equals(exposedFunctionGate)) {
            throw new IllegalStateException(
                    "SIMULATION_DATABASE_FUNCTION_ACL_OR_OWNER_UNSAFE");
        }

        var privateAssertionGate = jdbc.queryForObject("""
                WITH inspected AS (
                    SELECT function.oid,
                           function.proname,
                           function.proowner,
                           function.prosecdef,
                           function.provolatile,
                           function.proconfig,
                           pg_catalog.pg_get_functiondef(function.oid)
                               AS definition
                      FROM pg_catalog.pg_proc function
                     WHERE function.oid IN (
                         pg_catalog.to_regprocedure(
                             'control.assert_session_service_principal(uuid,text[])'
                         ),
                         pg_catalog.to_regprocedure(
                             'control.assert_session_active_service_principal(uuid,text[])'
                         )
                     )
                )
                SELECT count(*) = 2
                   AND bool_and(inspected.prosecdef)
                   AND bool_and(inspected.provolatile = 'v')
                   AND bool_and(
                       inspected.proconfig =
                       ARRAY['search_path=pg_catalog']::TEXT[]
                   )
                   AND bool_and(
                       pg_catalog.pg_get_userbyid(inspected.proowner)
                       <> session_user
                   )
                   AND bool_and(NOT pg_catalog.has_function_privilege(
                       inspected.oid,
                       'EXECUTE'
                   ))
                   AND bool_and(inspected.definition LIKE '%session_user%')
                   AND bool_and(
                       inspected.definition LIKE
                       '%service_principal_database_role_binding%'
                   )
                   AND bool_and(inspected.definition LIKE '%database_role_oid%')
                   AND bool_and(inspected.definition LIKE '%database_role_name%')
                   AND bool_and(inspected.definition LIKE '%pg_auth_members%')
                   AND bool_and(
                       inspected.definition LIKE '%transaction_isolation%'
                   )
                   AND bool_and(inspected.definition LIKE '%FOR SHARE%')
                  FROM inspected
                """, Boolean.class);
        if (!Boolean.TRUE.equals(privateAssertionGate)) {
            throw new IllegalStateException(
                    "SIMULATION_DATABASE_PRIVATE_BINDING_ASSERTION_UNSAFE");
        }
    }
}
