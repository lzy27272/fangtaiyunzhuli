SELECT format(
         'SELECT %L, count(*) FROM %I.%I;',
         tablename,
         schemaname,
         tablename
       )
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
