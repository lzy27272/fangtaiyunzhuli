\pset tuples_only on
\pset format unaligned

SELECT 'flyway_latest|' || version || '|' || success
FROM flyway_schema_history
WHERE installed_rank = (SELECT max(installed_rank) FROM flyway_schema_history);

SELECT 'flyway_success|' ||
       count(*) FILTER (WHERE success) || '|' ||
       count(*) FILTER (WHERE NOT success)
FROM flyway_schema_history;

SELECT 'public_tables|' || count(*)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

SELECT 'extensions|' || string_agg(extname, ',' ORDER BY extname)
FROM pg_extension;

SELECT 'rls_tables|' ||
       count(*) FILTER (WHERE c.relrowsecurity) || '|' ||
       count(*) FILTER (WHERE c.relforcerowsecurity)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');

SELECT 'tenant_tables_without_forced_rls|' ||
       coalesce(string_agg(c.table_name, ',' ORDER BY c.table_name), 'none')
FROM information_schema.columns c
JOIN pg_class p ON p.relname = c.table_name
JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = c.table_schema
WHERE c.table_schema = 'public'
  AND c.column_name = 'tenant_id'
  AND p.relkind IN ('r', 'p')
  AND NOT p.relforcerowsecurity;

SELECT 'app_role|' || rolsuper || '|' || rolcreatedb || '|' ||
       rolcreaterole || '|' || rolinherit || '|' || rolbypassrls
FROM pg_roles
WHERE rolname = 'hotel_ai_os_app';

SELECT 'app_privileges|' ||
       has_schema_privilege('hotel_ai_os_app', 'public', 'USAGE') || '|' ||
       has_table_privilege('hotel_ai_os_app', 'public.tenant', 'SELECT') || '|' ||
       has_table_privilege('hotel_ai_os_app', 'public.management_task', 'SELECT,INSERT,UPDATE,DELETE');

SELECT 'seed_counts|' ||
       (SELECT count(*) FROM tenant) || '|' ||
       (SELECT count(*) FROM user_account) || '|' ||
       (SELECT count(*) FROM app_role) || '|' ||
       (SELECT count(*) FROM work_package_definition);
